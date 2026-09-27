# MCP Data-Service Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `dynamic-ui`'s CSV-backed data source with a live connection to an MCP data service — the agent answers questions using real relational data instead of a flat file. The bundled `mock-data/` server (synthetic customers/orders/products) is the reference service; any MCP server exposing the `describe_query` + `query_*` convention works.

**Architecture:** `agent.py`'s `DynamicUIAgent` opens a persistent `mcp.ClientSession` to the data service at server startup (via a Starlette lifespan hook, kept alive by an `AsyncExitStack` for the process lifetime), discovers its tools, and runs a hand-rolled multi-turn tool-calling loop (automatic function calling is disabled — passing a live MCP session to it crashes on an unpicklable object inside `google-genai`'s config deep-copy). Each MCP tool's JSON Schema converts directly to a `FunctionDeclaration` via the public `parameters_json_schema` field. `agent_executor.py` and the entire frontend are unaffected — only `DynamicUIAgent.answer()` becomes `async`, its return contract is unchanged.

**Tech Stack:** Python 3.12, `mcp` (`>=1.28.1,<2`), `google-genai` (async client), existing `a2a-sdk`/`a2ui-agent-sdk` stack.

## Global Constraints

- A compatible MCP data service must already be running and reachable at `http://localhost:8001/mcp/` before any task's verification steps — the bundled one: `cd mock-data && uv run server.py` (this plan does not start or manage that service).
- `dynamic-ui`'s backend stays on `:8000`, the data service stays on `:8001` — do not let either task change these.
- No Google ADK — Gemini is called directly via `google-genai`'s async client (`client.aio.models.generate_content`).
- `automatic_function_calling` must be explicitly disabled (`types.AutomaticFunctionCallingConfig(disable=True)`) in every `generate_content` call in `agent.py` — this is not optional, it's the fix for the deep-copy crash documented in the spec.
- Tool schema conversion uses only the public `FunctionDeclaration.parameters_json_schema` field — never the private `google.genai._mcp_utils` module.
- This is a full replacement of the CSV data source, not a fallback/toggle — `csv_store.py`, `tools.py`, and `sample_data.csv` are deleted, not kept.
- No automated test suite (unchanged project-wide decision) — every task is verified by running a real command against the real running data service and checking real output.
- `GEMINI_API_KEY` is already set in the shell environment for verification steps — never print `.env` contents or the raw key value.

---

### Task 1: Update backend config (env, dependencies)

**Files:**
- Modify: `backend/.env.example`
- Modify: `backend/pyproject.toml`

**Interfaces:**
- Produces: `MCP_DATA_URL` env var convention, used by Task 4's `__main__.py`.

- [ ] **Step 1: Update `.env.example`**

Replace its content with:
```
# Copy this file to .env and fill in your API key.
# Get your API key at: https://aistudio.google.com/apikey
GEMINI_API_KEY=your_gemini_api_key_here

# URL of the MCP data server (Streamable-HTTP).
# The bundled mock server in ../mock-data serves at this URL.
MCP_DATA_URL=http://localhost:8001/mcp/

# Optional override of the Gemini model.
GEMINI_MODEL=gemini-3-flash-preview
```

- [ ] **Step 2: Update your own `.env`**

```bash
cd /Users/namdarmesri/Projects/dynamic-ui/backend
grep -q '^MCP_DATA_URL=' .env 2>/dev/null || printf 'MCP_DATA_URL=http://localhost:8001/mcp/\n' >> .env
```
(Do not print `.env`'s contents — it contains the live API key.)

- [ ] **Step 3: Remove `pandas` from `pyproject.toml`'s dependency list**

`pandas` is only used by `tools.py`/`csv_store.py`, both deleted in Task 5 — remove it now so `pyproject.toml` stays accurate. In the `dependencies = [...]` list, delete the line `"pandas>=2.2",`. Leave every other dependency untouched (note: `mcp` is pinned `>=1.28.1,<2` — v1 API, which this plan's `streamablehttp_client`/`FastMCP` usage targets).

- [ ] **Step 4: Verify**

```bash
cd /Users/namdarmesri/Projects/dynamic-ui/backend && uv sync
```
Expected: completes with no errors (this will report removing `pandas` and its transitive deps — expected, since `tools.py`/`csv_store.py` still import it until Task 5; that's fine, `uv sync` only manages the dependency *declaration*, unused imports don't break it).

- [ ] **Step 5: Commit**

```bash
cd /Users/namdarmesri/Projects/dynamic-ui && git add backend/.env.example backend/pyproject.toml backend/uv.lock
git commit -m "Add MCP_DATA_URL config, drop now-unused pandas dependency"
```

---

### Task 2: Rewrite `agent.py`

**Files:**
- Modify: `backend/agent.py` (full rewrite)

**Interfaces:**
- Consumes: the MCP data service at `MCP_DATA_URL`.
- Produces: `DynamicUIAgent(mcp_url: str, base_url: str, model_name: str = "gemini-3-flash-preview")` with:
  - `.catalog_id -> str`, `.agent_card -> AgentCard` (unchanged from before).
  - `async def connect(self, stack: contextlib.AsyncExitStack) -> None` — new. Must be called once before `answer()`.
  - `async def answer(self, query: str) -> tuple[str, Optional[list[dict[str, Any]]]]` — now async, same return contract as before.

- [ ] **Step 1: Replace `backend/agent.py` with this exact content**

```python
"""DynamicUIAgent: answers questions via Gemini + a live MCP data
server, no Google ADK.

Tool calls are dispatched manually (automatic_function_calling is disabled)
because passing a live mcp.ClientSession directly to google-genai's
automatic function calling crashes -- generate_content unconditionally
deep-copies the request config, and a live session holds an unpicklable
asyncio.Future. Converting each MCP tool's schema to a plain
FunctionDeclaration via the public parameters_json_schema field and
routing calls ourselves sidesteps this; verified against a running MCP
data service before committing to this design (see
docs/superpowers/specs/2026-07-10-mcp-data-service-integration-design.md).
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
            " customer, order, and product data."
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
```

- [ ] **Step 2: Verify against the running mock data service**

Confirm the service is up first:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8001/mcp/
```
(Expected: `200` on the GET fallback or `405` — either proves it's listening; the MCP endpoint speaks POST. If nothing listens, start it: `cd /Users/namdarmesri/Projects/dynamic-ui/mock-data && uv run server.py`.)

Then run a standalone verification script from `/Users/namdarmesri/Projects/dynamic-ui/backend`:
```bash
uv run python -c "
import asyncio
from contextlib import AsyncExitStack
from agent import DynamicUIAgent

async def main():
    agent = DynamicUIAgent(
        mcp_url='http://localhost:8001/mcp/',
        base_url='http://localhost:8000',
    )
    async with AsyncExitStack() as stack:
        await agent.connect(stack)
        text, payload = await agent.answer('Which orders are over \$100?')
        print('TEXT:', text)
        print('PAYLOAD MESSAGES:', len(payload) if payload else 0)

asyncio.run(main())
"
```
Expected: `TEXT:` a short correct answer referencing the mock data (e.g. mentioning the \$799.98 order or the \$399.99 monitor order); `PAYLOAD MESSAGES: 2` (a `createSurface` and an `updateComponents` message).

- [ ] **Step 3: Commit**

```bash
cd /Users/namdarmesri/Projects/dynamic-ui && git add backend/agent.py
git commit -m "Rewrite DynamicUIAgent to query the MCP data service via a live session"
```

---

### Task 3: Update `agent_executor.py`

**Files:**
- Modify: `backend/agent_executor.py`

**Interfaces:**
- Consumes: `DynamicUIAgent.answer()` (now `async`, from Task 2).

- [ ] **Step 1: Add `await`**

Change:
```python
        text, a2ui_messages = self._agent.answer(query)
```
to:
```python
        text, a2ui_messages = await self._agent.answer(query)
```
This is the only change to this file — `execute()` is already `async def`, so this isn't a sync/async boundary change.

- [ ] **Step 2: Verify it imports cleanly**

```bash
cd /Users/namdarmesri/Projects/dynamic-ui/backend && uv run python -c "from agent_executor import DynamicUIAgentExecutor; print('OK')"
```
Expected: `OK`. (Full behavioral verification happens in Task 5, once the whole server can run end-to-end.)

- [ ] **Step 3: Commit**

```bash
cd /Users/namdarmesri/Projects/dynamic-ui && git add backend/agent_executor.py
git commit -m "Await DynamicUIAgent.answer(), now async"
```

---

### Task 4: Update `__main__.py`

**Files:**
- Modify: `backend/__main__.py`

**Interfaces:**
- Consumes: `DynamicUIAgent(mcp_url, base_url, model_name)`, `DynamicUIAgent.connect(stack)` (Task 2).

- [ ] **Step 1: Replace `backend/__main__.py` with this exact content**

```python
"""Entrypoint: connects to an MCP data server, builds the agent, serves it over A2A."""

import logging
import os
from contextlib import AsyncExitStack, asynccontextmanager

import click
import uvicorn
from a2a.server.apps import A2AStarletteApplication
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import InMemoryTaskStore
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware

from agent import DynamicUIAgent
from agent_executor import DynamicUIAgentExecutor

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class MissingConfigError(Exception):
    """Exception for missing required configuration."""


@click.command()
@click.option("--host", default="localhost")
@click.option("--port", default=8000)
def main(host, port):
    try:
        if not os.getenv("GEMINI_API_KEY"):
            raise MissingConfigError("GEMINI_API_KEY environment variable not set.")

        mcp_url = os.getenv("MCP_DATA_URL")
        if not mcp_url:
            raise MissingConfigError(
                "MCP_DATA_URL environment variable not set."
            )

        base_url = f"http://{host}:{port}"
        model_name = os.getenv("GEMINI_MODEL", "gemini-3-flash-preview")

        agent = DynamicUIAgent(mcp_url, base_url=base_url, model_name=model_name)
        agent_executor = DynamicUIAgentExecutor(agent)

        request_handler = DefaultRequestHandler(
            agent_executor=agent_executor,
            task_store=InMemoryTaskStore(),
        )

        @asynccontextmanager
        async def lifespan(app):
            async with AsyncExitStack() as stack:
                await agent.connect(stack)
                logger.info("Connected to MCP data server at %s", mcp_url)
                yield

        server = A2AStarletteApplication(
            agent_card=agent.agent_card, http_handler=request_handler
        )
        app = server.build(lifespan=lifespan)
        app.add_middleware(
            CORSMiddleware,
            allow_origin_regex=r"http://localhost:\d+",
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

        uvicorn.run(app, host=host, port=port)
    except MissingConfigError as e:
        logger.error(f"Error: {e}")
        exit(1)


if __name__ == "__main__":
    main()
```

Note: the `MissingConfigError`/`exit(1)` pattern only covers the synchronous pre-flight checks (env vars present) — a failure *inside* `agent.connect()` during lifespan startup (e.g. the data service unreachable) surfaces as a Starlette/uvicorn startup failure instead, not a caught `MissingConfigError`. Both fail loudly and refuse to serve; they just report through different paths. Don't expect a clean `MissingConfigError`-style message for an unreachable MCP server specifically.

- [ ] **Step 2: Verify — restart the backend and confirm it connects at startup**

```bash
lsof -iTCP -sTCP:LISTEN -P | grep 8000 | awk '{print $2}' | xargs -r kill
sleep 1
cd /Users/namdarmesri/Projects/dynamic-ui/backend
nohup uv run . > /tmp/dynamic-ui-backend.log 2>&1 < /dev/null &
disown
sleep 3
grep "Connected to MCP data server" /tmp/dynamic-ui-backend.log
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8000/.well-known/agent-card.json
```
Expected: the grep finds the connection log line, and the curl returns `200`.

- [ ] **Step 3: Commit**

```bash
cd /Users/namdarmesri/Projects/dynamic-ui && git add backend/__main__.py
git commit -m "Add lifespan hook to open/close the MCP data-service session"
```

---

### Task 5: Delete CSV files, full end-to-end verification

**Files:**
- Delete: `backend/csv_store.py`
- Delete: `backend/tools.py`
- Delete: `backend/sample_data.csv`

**Interfaces:** None — this is the final integration/cleanup task.

- [ ] **Step 1: Delete the CSV-era files**

```bash
cd /Users/namdarmesri/Projects/dynamic-ui
git rm backend/csv_store.py backend/tools.py backend/sample_data.csv
```

- [ ] **Step 2: Restart the backend clean, confirm it still starts with the files gone**

```bash
lsof -iTCP -sTCP:LISTEN -P | grep 8000 | awk '{print $2}' | xargs -r kill
sleep 1
cd /Users/namdarmesri/Projects/dynamic-ui/backend
nohup uv run . > /tmp/dynamic-ui-backend.log 2>&1 < /dev/null &
disown
sleep 3
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8000/.well-known/agent-card.json
```
Expected: `200` (no import errors from the deleted files — confirms nothing else still references them).

- [ ] **Step 3: End-to-end verification against real questions, including one that exercises joins**

The mock data service must be running on `:8001` (`cd ../mock-data && uv run server.py`). The frontend dev server should already be running on `:3000` (start it if not: `cd /Users/namdarmesri/Projects/dynamic-ui/frontend && nohup npx next dev > /tmp/dynamic-ui-frontend.log 2>&1 < /dev/null & disown`).

Run each of these against the full stack via the Next.js proxy:
```bash
curl -s -X POST http://localhost:3000/api/agent -H 'Content-Type: application/json' \
  -d '{"query": "List all customers."}' | python3 -m json.tool

curl -s -X POST http://localhost:3000/api/agent -H 'Content-Type: application/json' \
  -d '{"query": "Which orders are over $100?"}' | python3 -m json.tool

curl -s -X POST http://localhost:3000/api/agent -H 'Content-Type: application/json' \
  -d '{"query": "Show me order 5 along with its customer."}' | python3 -m json.tool
```
Expected: all three return non-empty `text` and `a2uiMessages` with real data traceable to the mock service's synthetic dataset (not fabricated) — the third question in particular should show the agent using `expand` (a join), which the CSV-backed version never exercised.

- [ ] **Step 4: Manual browser smoke test**

Open `http://localhost:3000`, ask "Which orders are over $100?", confirm a sensible UI renders (table or card) with correct data. This mirrors the original project's Task 12 smoke test, now against the mock data service instead of the CSV fixture.

- [ ] **Step 5: Commit**

```bash
cd /Users/namdarmesri/Projects/dynamic-ui && git commit -m "Remove CSV data source; dynamic-ui now backed by the MCP data service end-to-end"
```
