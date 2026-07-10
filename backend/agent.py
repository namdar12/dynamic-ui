"""DynamicUIAgent: answers questions via Gemini + lib-data-access's live MCP
server, no Google ADK.

Tool calls are dispatched manually (automatic_function_calling is disabled)
because passing a live mcp.ClientSession directly to google-genai's
automatic function calling crashes -- generate_content unconditionally
deep-copies the request config, and a live session holds an unpicklable
asyncio.Future. Converting each MCP tool's schema to a plain
FunctionDeclaration via the public parameters_json_schema field and
routing calls ourselves sidesteps this; verified against the real running
lib-data-access service before committing to this design (see
docs/superpowers/specs/2026-07-10-lib-data-access-integration-design.md).
"""

import json
import os
from contextlib import AsyncExitStack
from pathlib import Path
from typing import Any, Optional

from a2a.types import AgentCapabilities, AgentCard, AgentSkill
from a2ui.a2a.extension import get_a2ui_agent_extension
from a2ui.parser.payload_fixer import parse_and_fix
from a2ui.schema.constants import VERSION_0_9
from a2ui.schema.manager import A2uiSchemaManager, CatalogConfig
from google import genai
from google.genai import types
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

CATALOG_PATH = str(Path(__file__).parent / "catalog" / "dynamic_ui_catalog.json")

# Safety cap on tool-calling turns per question, in case the model never
# converges to a final answer.
MAX_TOOL_TURNS = 8


class DynamicUIAgent:
    """Answers questions using lib-data-access's live data, rendering answers as A2UI UI."""

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
        self._system_prompt = self._build_system_prompt()
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

    def _send_a2ui_json_declaration(self) -> types.FunctionDeclaration:
        return types.FunctionDeclaration(
            name="send_a2ui_json_to_client",
            description=(
                "Sends A2UI JSON to the client to render rich UI for the"
                " user. Call this exactly once per turn with a valid A2UI"
                " JSON array of messages."
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
                    }
                },
                "required": ["a2ui_json"],
            },
        )

    def _build_system_prompt(self) -> str:
        role_description = (
            "You are a data assistant that answers questions about"
            " vendor, GL line, and rule exception data."
        )
        workflow_description = (
            "To answer, first call describe_query on the relevant"
            " entity/entities to learn their fields and query grammar,"
            " then call the appropriate query/CRUD tool(s) as needed."
            " Then render your answer as UI by calling the"
            " send_a2ui_json_to_client tool exactly once, passing a valid"
            " A2UI JSON array of messages (a createSurface message with"
            " surfaceId 'main' and catalogId"
            f" '{self._catalog.catalog_id}', followed by an"
            " updateComponents message) as the a2ui_json argument (a JSON"
            " string). Do NOT embed A2UI JSON directly in your text"
            " response -- always use the tool call instead. After calling"
            " the tool, give a brief one-sentence conversational reply."
        )
        return "\n\n".join(
            [
                role_description,
                f"## Workflow Description:\n{workflow_description}",
                self._catalog.render_as_llm_instructions(),
            ]
        )

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
                "Answers questions about vendor/GL/rule-exception data,"
                " rendering results as UI."
            ),
            tags=["data", "lib-data-access"],
            examples=["Which GL lines are over $1000?"],
        )
        return AgentCard(
            name="Dynamic UI Agent",
            description="Answers questions about live data with rendered UI.",
            url=base_url,
            version="0.1.0",
            default_input_modes=["text", "text/plain"],
            default_output_modes=["text", "text/plain"],
            capabilities=AgentCapabilities(streaming=False, extensions=[extension]),
            skills=[skill],
        )

    async def answer(self, query: str) -> tuple[str, Optional[list[dict[str, Any]]]]:
        """Answers one question. Returns (reply_text, a2ui_messages_or_None)."""
        assert self._session is not None and self._gemini_tool is not None, (
            "connect() must be called before answer()"
        )

        captured: dict[str, Any] = {}
        contents: list[types.Content] = [
            types.Content(role="user", parts=[types.Part(text=query)])
        ]

        for _ in range(MAX_TOOL_TURNS):
            response = await self._client.aio.models.generate_content(
                model=self._model_name,
                contents=contents,
                config=types.GenerateContentConfig(
                    system_instruction=self._system_prompt,
                    tools=[self._gemini_tool],
                    automatic_function_calling=types.AutomaticFunctionCallingConfig(
                        disable=True
                    ),
                ),
            )
            candidate = response.candidates[0]
            contents.append(candidate.content)

            function_calls = [
                part.function_call
                for part in candidate.content.parts
                if part.function_call
            ]
            if not function_calls:
                return response.text or "", captured.get("payload")

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
            contents.append(types.Content(role="user", parts=response_parts))

        return "Sorry, I couldn't complete that request.", None

    async def _call_tool(
        self, name: str, args: dict[str, Any], captured: dict[str, Any]
    ) -> dict[str, Any]:
        if name == "send_a2ui_json_to_client":
            try:
                payload = parse_and_fix(args["a2ui_json"])
                self._catalog.validator.validate(payload)
                captured["payload"] = payload
                return {"validated_a2ui_json": payload}
            except Exception as e:
                return {"error": f"Failed to validate A2UI JSON: {e}"}

        try:
            result = await self._session.call_tool(name, args)
        except Exception as e:
            return {"error": f"Tool call to '{name}' failed: {e}"}

        result_text = "".join(
            c.text for c in result.content if hasattr(c, "text")
        )
        try:
            return json.loads(result_text)
        except json.JSONDecodeError:
            return {"result": result_text}
