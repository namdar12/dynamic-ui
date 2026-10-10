"""DynamicUIAgent: answers questions via Gemini + a live MCP data
server, no Google ADK.

Tool calls are dispatched manually (automatic_function_calling is disabled)
because passing a live mcp.ClientSession directly to google-genai's
automatic function calling crashes -- generate_content unconditionally
deep-copies the request config, and a live session holds an unpicklable
asyncio.Future. Converting each MCP tool's schema to a plain
FunctionDeclaration via the public parameters_json_schema field and
routing calls ourselves sidesteps this; verified against a running MCP data service before committing
to this design (see
docs/superpowers/specs/2026-07-10-mcp-data-service-integration-design.md).
"""

import json
import logging
import os
from contextlib import AsyncExitStack
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional

from a2a.types import AgentCapabilities, AgentCard, AgentSkill
from a2ui.a2a.extension import get_a2ui_agent_extension
from a2ui.parser.payload_fixer import parse_and_fix
from a2ui.schema.constants import VERSION_0_9
from a2ui.schema.manager import A2uiSchemaManager, CatalogConfig
from google import genai
from google.genai import types
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

logger = logging.getLogger(__name__)

CATALOG_PATH = str(Path(__file__).parent / "catalog" / "dynamic_ui_catalog.json")
EXAMPLES_PATH = Path(__file__).parent / "catalog" / "few_shot_examples.json"

# The mistakes the model actually makes against this catalog (measured over a
# batch of questions): an invented `spacing` prop fails validation and costs a
# full UI rewrite, and Markdown in Text renders as literal asterisks.
COMPONENT_RULES = (
    "The validator rejects any property a component's schema doesn't"
    " define, and a rejected UI must be rewritten from scratch, so use only"
    " these:\n"
    "- Row and Column take only children, justify and align (List also"
    " direction). There is NO spacing, gap, padding or style property:"
    " children are spaced automatically.\n"
    "- Card takes exactly one child ID (child, never children); wrap several"
    " components in a Column first.\n"
    "- Text takes only text and variant (h1-h5, caption, body). The client"
    " shows Text as plain text and does not render Markdown, whatever the"
    " catalog says: never use **bold**, _italics_, # headings or - bullets."
    " Use a heading variant for emphasis and write label/value pairs as"
    " plain 'Label: value'.\n"
    "- Any component may set weight, but only as a direct child of a Row or"
    " Column."
)

# Safety cap on tool-calling turns per question, in case the model never
# converges to a final answer.
MAX_TOOL_TURNS = 8

OUT_OF_TURNS_PROMPT = (
    "You have run out of tool calls for this question. Without calling any"
    " more tools, explain in two or three sentences what you found. If the"
    " data doesn't contain what was asked, say so plainly, name the fields"
    " that are available, and suggest a related question you can answer."
)

# Called after each MCP data tool call with {"name", "args"}, plus "count"
# when the result reports a row count and "failed" when the call errored.
StepCallback = Callable[[dict[str, Any]], Awaitable[None]]


class DynamicUIAgent:
    """Answers questions using a live MCP data service, rendering answers as A2UI UI."""

    def __init__(
        self,
        mcp_url: str,
        base_url: str,
        model_name: str = "gemini-3-flash-preview",
    ):
        self._mcp_url = mcp_url
        self._model_name = model_name
        self._client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
        self._session: Optional[ClientSession] = None
        self._gemini_tool: Optional[types.Tool] = None

        self._schema_manager = A2uiSchemaManager(
            version=VERSION_0_9,
            catalogs=[
                CatalogConfig.from_path(
                    name="dynamic-ui", catalog_path=CATALOG_PATH
                )
            ],
        )
        self._catalog = self._schema_manager.get_selected_catalog()
        self._examples = self._load_examples()
        self._system_prompt = self._build_system_prompt(schemas={})
        self._agent_card = self._build_agent_card(base_url)

    @property
    def catalog_id(self) -> str:
        return self._catalog.catalog_id

    @property
    def agent_card(self) -> AgentCard:
        return self._agent_card

    async def connect(self, stack: AsyncExitStack) -> None:
        """Opens the MCP session, kept alive by `stack` for the process lifetime.

        Must be called once (e.g. from a Starlette lifespan hook) before
        `answer()` is ever called.
        """
        read, write, _ = await stack.enter_async_context(
            streamablehttp_client(self._mcp_url)
        )
        session = await stack.enter_async_context(ClientSession(read, write))
        await session.initialize()

        mcp_tools = (await session.list_tools()).tools
        function_declarations = [
            types.FunctionDeclaration(
                name=t.name,
                description=t.description,
                parameters_json_schema=t.inputSchema,
            )
            for t in mcp_tools
        ]
        function_declarations.append(self._send_a2ui_json_declaration())

        self._session = session
        self._gemini_tool = types.Tool(function_declarations=function_declarations)
        self._system_prompt = self._build_system_prompt(
            schemas=await self._describe_entities(mcp_tools)
        )

    async def _describe_entities(self, mcp_tools: list[Any]) -> dict[str, Any]:
        """Runs describe_query once per `query_<entity>` tool at startup.

        Putting the results in the system prompt saves every question a
        describe_query round trip to Gemini. Entities that fail to describe are
        left out; the model can still call describe_query for them itself.
        """
        names = {t.name for t in mcp_tools}
        if "describe_query" not in names:
            return {}
        schemas: dict[str, Any] = {}
        for name in sorted(names):
            if not name.startswith("query_"):
                continue
            entity = name.removeprefix("query_")
            try:
                result = await self._session.call_tool("describe_query", {"entity": entity})
            except Exception as e:
                logger.warning("describe_query(%r) failed: %s", entity, e)
                continue
            if result.isError:
                logger.warning("describe_query(%r) returned an error", entity)
                continue
            schemas[entity] = _result_payload(result)
        logger.info("Preloaded schemas for: %s", ", ".join(schemas) or "none")
        return schemas

    def _send_a2ui_json_declaration(self) -> types.FunctionDeclaration:
        return types.FunctionDeclaration(
            name="send_a2ui_json_to_client",
            description=(
                "Sends A2UI JSON to the client to render rich UI for the"
                " user, along with a short reply. Call this exactly once per"
                " turn with a valid A2UI JSON array of messages; a valid call"
                " ends the turn."
            ),
            parameters_json_schema={
                "type": "object",
                "properties": {
                    "a2ui_json": {
                        "type": "string",
                        "description": (
                            "Valid A2UI JSON (a JSON array of messages) to"
                            " send to the client."
                        ),
                    },
                    "reply": {
                        "type": "string",
                        "description": (
                            "A brief one-sentence conversational reply shown"
                            " above the UI."
                        ),
                    },
                },
                "required": ["a2ui_json", "reply"],
            },
        )

    def _build_system_prompt(self, schemas: dict[str, Any]) -> str:
        role_description = (
            "You are a data assistant that answers questions about"
            " customer, order, and product data."
        )
        if schemas:
            discovery = (
                "The describe_query result for every entity is listed under"
                " Data Schemas below: use those fields and that query grammar"
                " directly, and call describe_query only for an entity that"
                " isn't listed. Call the appropriate query/CRUD tool(s) as"
                " needed, requesting independent queries together in one turn."
            )
        else:
            discovery = (
                "To answer, first call describe_query on the relevant"
                " entity/entities to learn their fields and query grammar,"
                " then call the appropriate query/CRUD tool(s) as needed."
            )
        workflow_description = (
            f"{discovery}"
            " Then render your answer as UI by calling the"
            " send_a2ui_json_to_client tool exactly once, passing a valid"
            " A2UI JSON array of messages (a createSurface message with"
            " surfaceId 'main' and catalogId"
            f" '{self._catalog.catalog_id}', followed by an"
            " updateComponents message) as the a2ui_json argument (a JSON"
            " string). Do NOT embed A2UI JSON directly in your text"
            " response -- always use the tool call instead. Put a brief"
            " one-sentence conversational reply in the tool's reply argument;"
            " a valid call ends your turn, so write nothing after it."
        )
        missing_data_description = (
            "If the schemas show the data has no entity or field that"
            " can answer the question (for example, the user asks about"
            " inventory but no entity tracks stock), stop querying: do not"
            " guess entity or field names. Reply in plain text, without"
            " calling send_a2ui_json_to_client, saying the data doesn't"
            " include that, naming the fields that do exist for the closest"
            " entity, and suggesting one related question you can answer."
        )
        sections = [
            role_description,
            f"## Workflow Description:\n{workflow_description}",
            f"## When the data can't answer:\n{missing_data_description}",
        ]
        if schemas:
            sections.append(f"## Data Schemas:\n{json.dumps(schemas, indent=1)}")
        sections.append(self._catalog.render_as_llm_instructions())
        sections.append(f"## Component rules:\n{COMPONENT_RULES}")
        sections.append(f"## Examples:\n{self._render_examples()}")
        return "\n\n".join(sections)

    def _load_examples(self) -> list[dict[str, Any]]:
        examples = json.loads(EXAMPLES_PATH.read_text())
        # Fail fast: an example that drifted from the catalog would teach the
        # model exactly the invalid UI the examples exist to prevent.
        for example in examples:
            self._catalog.validator.validate(example["a2ui"])
        return examples

    def _render_examples(self) -> str:
        # Compact JSON on purpose: the model mirrors the examples' formatting,
        # and every newline and indent it skips is an output token saved.
        blocks = [
            "Each example is a question and the send_a2ui_json_to_client call"
            " that answers it. The values are illustrative: always use the"
            " values from your own query results."
        ]
        for example in self._examples:
            blocks.append(
                f"Question: {example['question']}\n"
                f"reply: {example['reply']}\n"
                f"a2ui_json: {json.dumps(example['a2ui'], separators=(',', ':'))}"
            )
        return "\n\n".join(blocks)

    def _build_agent_card(self, base_url: str) -> AgentCard:
        extension = get_a2ui_agent_extension(
            VERSION_0_9,
            self._schema_manager.accepts_inline_catalogs,
            self._schema_manager.supported_catalog_ids,
        )
        skill = AgentSkill(
            id="answer_data_questions",
            name="Answer Data Questions",
            description=(
                "Answers questions about customer/order/product data,"
                " rendering results as UI."
            ),
            tags=["data", "mcp"],
            examples=["Which orders are over $100?"],
        )
        return AgentCard(
            name="Dynamic UI Agent",
            description="Answers questions about live data with rendered UI.",
            url=base_url,
            version="0.1.0",
            default_input_modes=["text", "text/plain"],
            default_output_modes=["text", "text/plain"],
            capabilities=AgentCapabilities(streaming=True, extensions=[extension]),
            skills=[skill],
        )

    async def answer(
        self, query: str, on_step: Optional[StepCallback] = None
    ) -> tuple[str, Optional[list[dict[str, Any]]], list[dict[str, Any]]]:
        """Answers one question, reporting each MCP data tool call to `on_step`.

        Returns (reply_text, a2ui_messages_or_None, tool_calls), where
        tool_calls lists every MCP data tool call made, as {"name", "args"}.
        """
        assert self._session is not None and self._gemini_tool is not None, (
            "connect() must be called before answer()"
        )

        captured: dict[str, Any] = {"tool_calls": []}
        contents: list[types.Content] = [
            types.Content(role="user", parts=[types.Part(text=query)])
        ]

        for _ in range(MAX_TOOL_TURNS):
            response = await self._client.aio.models.generate_content(
                model=self._model_name,
                contents=contents,
                config=self._generate_config(allow_tool_calls=True),
            )
            candidate = response.candidates[0]
            contents.append(candidate.content)

            function_calls = [
                part.function_call
                for part in candidate.content.parts
                if part.function_call
            ]
            if not function_calls:
                return (
                    response.text or "",
                    captured.get("payload"),
                    captured["tool_calls"],
                )

            response_parts = []
            for fc in function_calls:
                result_payload = await self._call_tool(
                    fc.name, dict(fc.args), captured
                )
                response_parts.append(
                    types.Part.from_function_response(
                        name=fc.name, response=result_payload
                    )
                )
                if on_step and fc.name != "send_a2ui_json_to_client":
                    await on_step(_step(fc.name, dict(fc.args), result_payload))

            # A validated UI payload carries its reply, so the answer is done:
            # skip the round trip that would only echo the tool result back.
            if "payload" in captured:
                reply = captured["reply"] or "".join(
                    part.text
                    for part in candidate.content.parts
                    if part.text and not part.thought
                )
                return reply, captured["payload"], captured["tool_calls"]
            contents.append(types.Content(role="user", parts=response_parts))

        # Out of tool turns: rather than a bare apology, have the model explain
        # what it found (and what the data lacks) without calling more tools.
        contents.append(
            types.Content(
                role="user",
                parts=[types.Part(text=OUT_OF_TURNS_PROMPT)],
            )
        )
        response = await self._client.aio.models.generate_content(
            model=self._model_name,
            contents=contents,
            config=self._generate_config(allow_tool_calls=False),
        )
        return (
            response.text or "Sorry, I couldn't complete that request.",
            captured.get("payload"),
            captured["tool_calls"],
        )

    def _generate_config(self, allow_tool_calls: bool) -> types.GenerateContentConfig:
        # Tools stay declared even when calls are off: the history already
        # holds function calls, and mode NONE just forbids new ones.
        return types.GenerateContentConfig(
            system_instruction=self._system_prompt,
            tools=[self._gemini_tool],
            tool_config=types.ToolConfig(
                function_calling_config=types.FunctionCallingConfig(
                    mode="AUTO" if allow_tool_calls else "NONE"
                )
            ),
            automatic_function_calling=types.AutomaticFunctionCallingConfig(
                disable=True
            ),
        )

    async def _call_tool(
        self, name: str, args: dict[str, Any], captured: dict[str, Any]
    ) -> dict[str, Any]:
        if name == "send_a2ui_json_to_client":
            try:
                payload = parse_and_fix(args["a2ui_json"])
                self._catalog.validator.validate(payload)
                captured["payload"] = payload
                captured["reply"] = str(args.get("reply") or "")
                return {"validated_a2ui_json": payload}
            except Exception as e:
                return {"error": f"Failed to validate A2UI JSON: {e}"}

        captured["tool_calls"].append({"name": name, "args": args})
        try:
            result = await self._session.call_tool(name, args)
        except Exception as e:
            return {"error": f"Tool call to '{name}' failed: {e}"}
        return _result_payload(result)


def _result_payload(result: Any) -> dict[str, Any]:
    """An MCP tool result's text content, parsed as JSON when it is JSON."""
    result_text = "".join(c.text for c in result.content if hasattr(c, "text"))
    try:
        return json.loads(result_text)
    except json.JSONDecodeError:
        return {"result": result_text}


def _step(name: str, args: dict[str, Any], result: dict[str, Any]) -> dict[str, Any]:
    step: dict[str, Any] = {"name": name, "args": args}
    if isinstance(result.get("count"), int):
        step["count"] = result["count"]
    if "error" in result:
        step["failed"] = True
    return step
