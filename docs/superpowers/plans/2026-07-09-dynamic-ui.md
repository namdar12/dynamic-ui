# dynamic-ui Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A CSV-backed chatbot where a Python A2A agent (no Google ADK) answers questions with Gemini and renders the answer as A2UI-described UI, consumed by a Next.js frontend using the real `@a2ui/react` renderer.

**Architecture:** Two standalone local processes. `backend/` is a Python A2A server (uvicorn + `a2a-sdk`) that calls Gemini directly via `google-genai`'s automatic function-calling, with CSV-query tools and a dedicated `send_a2ui_json_to_client` tool the model calls to emit its UI payload. `frontend/` is a Next.js (App Router) app whose `app/page.tsx` is a chat UI rendering a live `@a2ui/react` surface, fed via a server-side API route that proxies to the backend over A2A (non-streaming, single-turn per question).

**Tech Stack:** Python 3.12, `uv`, `a2ui-agent-sdk`, `a2ui-core`, `google-genai`, `a2a-sdk`, `pandas`, `uvicorn`; Next.js (latest, App Router, TypeScript), `@a2ui/react`, `@a2ui/web_core`, `@a2a-js/sdk`, `zod`.

## Global Constraints

- No Google ADK anywhere in the backend — Gemini is called directly via `google-genai`.
- Non-streaming, single-turn: one user question → one resolved answer (text + optional A2UI payload). No SSE, no incremental rendering.
- No follow-up/interactive actions from rendered UI (no buttons triggering new agent calls). Each question is independent.
- A2UI payload is captured via a dedicated tool call (`send_a2ui_json_to_client`), NOT via embedded `<a2ui-json>` tags in text.
- No automated test suite (no pytest, no Vitest/RTL) — every task is verified by running a real command and checking real output, per explicit scope decision.
- `dynamic-ui` is a fully standalone project (its own git repo, own dependency management) — no path/workspace dependency into the sibling `/Users/namdarmesri/Projects/A2UI` monorepo. `a2ui-agent-sdk` and `a2ui-core` are installed from PyPI as prebuilt wheels (verified: both ship `bdist_wheel`, avoiding the ANTLR/Java build-from-source issue that a workspace/path dependency would hit). `@a2ui/react`, `@a2ui/web_core`, `@a2a-js/sdk` are installed from npm.
- A2UI spec version `0.9` throughout (constant `VERSION_0_9 = "0.9"`), matching the frontend's `@a2ui/react/v0_9` / `@a2ui/web_core/v0_9` subpath imports.
- Custom catalog id: the literal string `"dynamic-ui-catalog"` — must match exactly between `backend/catalog/dynamic_ui_catalog.json`'s `"catalogId"` field and the frontend's `new Catalog("dynamic-ui-catalog", [...])` call.
- Gemini model: `gemini-3-flash-preview` (verified working live against the real API during planning).
- Backend serves on `http://localhost:8000`; frontend dev server on Next.js's default `http://localhost:3000`.
- A placeholder fixture CSV (`backend/sample_data.csv`) is used for all dev-time verification until the user supplies their real CSV via the `CSV_PATH` env var — the tools must stay domain-agnostic (no column names hardcoded outside the fixture).

---

### Task 1: Scaffold backend project

**Files:**
- Create: `backend/pyproject.toml`
- Create: `backend/.env.example`
- Create: `backend/.gitignore`
- Create: `backend/sample_data.csv`

**Interfaces:**
- Produces: an installable `backend/` uv project with `a2ui`, `google.genai`, `pandas`, `a2a`, `click`, `dotenv` importable from its venv.

- [ ] **Step 1: Create the backend directory and pyproject.toml**

```bash
mkdir -p /Users/namdarmesri/Projects/dynamic-ui/backend
```

Write `/Users/namdarmesri/Projects/dynamic-ui/backend/pyproject.toml`:

```toml
[project]
name = "dynamic-ui-backend"
version = "0.1.0"
description = "CSV chatbot agent using A2UI over A2A, no Google ADK."
readme = "README.md"
requires-python = ">=3.10"
dependencies = [
    "a2ui-agent-sdk>=0.4.0",
    "a2ui-core>=0.1.1",
    "google-genai>=1.27.0",
    "a2a-sdk[http-server]>=0.3.0",
    "uvicorn>=0.40.0",
    "python-dotenv>=1.1.0",
    "pandas>=2.2",
    "click>=8.1.8",
]

[tool.hatch.build.targets.wheel]
packages = ["."]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```

- [ ] **Step 2: Write `.env.example`**

```
# Copy this file to .env and fill in your API key.
# Get your API key at: https://aistudio.google.com/apikey
GEMINI_API_KEY=your_gemini_api_key_here

# Path to the CSV file the agent answers questions about.
CSV_PATH=sample_data.csv

# Optional override of the Gemini model.
GEMINI_MODEL=gemini-3-flash-preview
```

- [ ] **Step 3: Write `.gitignore`**

```
.venv/
.env
__pycache__/
*.pyc
```

- [ ] **Step 4: Write the dev-time fixture CSV**

Write `/Users/namdarmesri/Projects/dynamic-ui/backend/sample_data.csv`:

```csv
name,category,price,in_stock
Widget A,Tools,9.99,true
Widget B,Tools,14.99,false
Gadget X,Electronics,29.99,true
Gadget Y,Electronics,49.99,true
Gizmo Z,Electronics,19.99,false
Hammer Pro,Tools,24.99,true
Screwdriver Set,Tools,12.49,true
Bluetooth Speaker,Electronics,39.99,false
```

(This is a placeholder only — the user will supply their real CSV later via `CSV_PATH`. Nothing downstream may hardcode these column names outside this fixture.)

- [ ] **Step 5: Sync and verify dependencies install cleanly**

Run:
```bash
cd /Users/namdarmesri/Projects/dynamic-ui/backend && uv sync
```
Expected: completes with no build errors (both `a2ui-agent-sdk` and `a2ui-core` install from prebuilt wheels — no ANTLR/Java build step should run).

Run:
```bash
cd /Users/namdarmesri/Projects/dynamic-ui/backend && uv run python -c "import a2ui, google.genai, pandas, a2a, click, dotenv; print('OK')"
```
Expected: prints `OK` with no `ImportError`.

- [ ] **Step 6: Commit**

```bash
cd /Users/namdarmesri/Projects/dynamic-ui && git add backend/pyproject.toml backend/.env.example backend/.gitignore backend/sample_data.csv backend/uv.lock
git commit -m "Scaffold backend project with A2UI/Gemini/A2A dependencies"
```

---

### Task 2: `csv_store.py` — load the CSV into a DataFrame

**Files:**
- Create: `backend/csv_store.py`

**Interfaces:**
- Produces: `load_dataframe(csv_path: str) -> pandas.DataFrame`, `CsvLoadError(Exception)`.

- [ ] **Step 1: Write `csv_store.py`**

```python
"""Loads the CSV configured via CSV_PATH into a pandas DataFrame."""

import pandas as pd


class CsvLoadError(Exception):
    """Raised when the configured CSV_PATH cannot be loaded."""


def load_dataframe(csv_path: str) -> pd.DataFrame:
    """Loads a CSV file into a DataFrame, raising CsvLoadError on failure."""
    try:
        return pd.read_csv(csv_path)
    except FileNotFoundError as e:
        raise CsvLoadError(
            f"CSV file not found at '{csv_path}'. Set CSV_PATH to a valid file."
        ) from e
    except pd.errors.EmptyDataError as e:
        raise CsvLoadError(f"CSV file at '{csv_path}' is empty.") from e
    except pd.errors.ParserError as e:
        raise CsvLoadError(f"CSV file at '{csv_path}' could not be parsed: {e}") from e
```

- [ ] **Step 2: Verify it loads the fixture CSV**

Run:
```bash
cd /Users/namdarmesri/Projects/dynamic-ui/backend && uv run python -c "
from csv_store import load_dataframe
df = load_dataframe('sample_data.csv')
print(df.shape)
print(list(df.columns))
"
```
Expected: `(8, 4)` and `['name', 'category', 'price', 'in_stock']`.

- [ ] **Step 3: Verify the fail-fast path**

Run:
```bash
cd /Users/namdarmesri/Projects/dynamic-ui/backend && uv run python -c "
from csv_store import load_dataframe, CsvLoadError
try:
    load_dataframe('does_not_exist.csv')
    print('FAIL: no exception raised')
except CsvLoadError as e:
    print('OK:', e)
"
```
Expected: prints `OK: CSV file not found at 'does_not_exist.csv'...`.

- [ ] **Step 4: Commit**

```bash
cd /Users/namdarmesri/Projects/dynamic-ui && git add backend/csv_store.py
git commit -m "Add CSV loading with fail-fast error handling"
```

---

### Task 3: `tools.py` — CSV query tools exposed to the LLM

**Files:**
- Create: `backend/tools.py`

**Interfaces:**
- Consumes: nothing beyond a `pandas.DataFrame` passed to the constructor.
- Produces: `CsvTools(dataframe: pandas.DataFrame)` with bound methods `describe_columns() -> str` and `query_data(filters: dict | None, sort_by: str | None, ascending: bool, group_by: str | None, limit: int) -> str`, both returning JSON strings (never raising — errors come back as a JSON `{"error": "..."}` string so a calling LLM can retry).

- [ ] **Step 1: Write `tools.py`**

```python
"""Generic, domain-agnostic CSV query tools exposed to the LLM as function-calling tools."""

import json
from typing import Any, Optional

import pandas as pd


class CsvTools:
    """Tools for querying a pandas DataFrame loaded from a CSV. Column-agnostic."""

    def __init__(self, dataframe: pd.DataFrame):
        self._df = dataframe

    def describe_columns(self) -> str:
        """Returns the CSV's column names, data types, and a few sample rows as JSON.

        Call this first to learn what columns exist before calling query_data.
        """
        sample = self._df.head(3).to_dict(orient="records")
        dtypes = {col: str(dtype) for col, dtype in self._df.dtypes.items()}
        return json.dumps(
            {
                "columns": list(self._df.columns),
                "dtypes": dtypes,
                "row_count": len(self._df),
                "sample_rows": sample,
            },
            default=str,
        )

    def query_data(
        self,
        filters: Optional[dict[str, Any]] = None,
        sort_by: Optional[str] = None,
        ascending: bool = True,
        group_by: Optional[str] = None,
        limit: int = 20,
    ) -> str:
        """Filters, sorts, groups, and limits CSV rows, returning JSON.

        Args:
          filters: Exact-match column/value pairs to filter rows by, e.g.
            {"category": "Electronics"}. Values are compared as strings.
          sort_by: Column name to sort by.
          ascending: Sort direction; ignored if sort_by is not set.
          group_by: Column name to group by, returning per-group row counts
            instead of raw rows.
          limit: Maximum number of rows/groups to return.

        Returns:
          A JSON array of row/group objects on success, or a JSON object
          {"error": "..."} if a column name is invalid.
        """
        df = self._df

        for column, value in (filters or {}).items():
            if column not in df.columns:
                return json.dumps(
                    {
                        "error": (
                            f"Unknown column '{column}'. Available columns:"
                            f" {list(df.columns)}"
                        )
                    }
                )
            df = df[df[column].astype(str) == str(value)]

        if group_by:
            if group_by not in df.columns:
                return json.dumps(
                    {
                        "error": (
                            f"Unknown column '{group_by}'. Available columns:"
                            f" {list(df.columns)}"
                        )
                    }
                )
            result = df.groupby(group_by).size().reset_index(name="count")
            if sort_by and sort_by in result.columns:
                result = result.sort_values(sort_by, ascending=ascending)
            return result.head(limit).to_json(orient="records")

        if sort_by:
            if sort_by not in df.columns:
                return json.dumps(
                    {
                        "error": (
                            f"Unknown column '{sort_by}'. Available columns:"
                            f" {list(df.columns)}"
                        )
                    }
                )
            df = df.sort_values(sort_by, ascending=ascending)

        return df.head(limit).to_json(orient="records")
```

- [ ] **Step 2: Verify against the fixture CSV**

Run:
```bash
cd /Users/namdarmesri/Projects/dynamic-ui/backend && uv run python -c "
from csv_store import load_dataframe
from tools import CsvTools

tools = CsvTools(load_dataframe('sample_data.csv'))
print(tools.describe_columns())
print(tools.query_data(filters={'category': 'Electronics'}, sort_by='price'))
print(tools.query_data(filters={'nonexistent_column': 'x'}))
"
```
Expected: first line is JSON with `columns`/`dtypes`/`sample_rows`; second line is a JSON array of the 3 Electronics rows sorted by price; third line is `{"error": "Unknown column 'nonexistent_column'. ..."}`.

- [ ] **Step 3: Commit**

```bash
cd /Users/namdarmesri/Projects/dynamic-ui && git add backend/tools.py
git commit -m "Add domain-agnostic CSV query tools"
```

---

### Task 4: Custom catalog — basic catalog + `Table` component

**Files:**
- Create: `backend/catalog/dynamic_ui_catalog.json` (generated by a one-off script, not hand-written)

**Interfaces:**
- Produces: a self-contained A2UI catalog JSON file with `catalogId: "dynamic-ui-catalog"`, all basic-catalog components, plus a custom `Table` component (`columns: [{key, label}]`, `rows: [object]`).

- [ ] **Step 1: Generate the catalog file from the bundled basic catalog**

```bash
mkdir -p /Users/namdarmesri/Projects/dynamic-ui/backend/catalog
```

Run this from `backend/` (verified live during planning — produces a valid catalog with 19 components):

```bash
cd /Users/namdarmesri/Projects/dynamic-ui/backend && uv run python -c "
import importlib.resources
import json

src = importlib.resources.files('a2ui').joinpath('assets', '0.9', 'catalog.json')
catalog = json.loads(src.read_text())

catalog['catalogId'] = 'dynamic-ui-catalog'
catalog['title'] = 'Dynamic UI Catalog'

catalog['components']['Table'] = {
    'type': 'object',
    'allOf': [
        {'\$ref': 'common_types.json#/\$defs/ComponentCommon'},
        {'\$ref': '#/\$defs/CatalogComponentCommon'},
        {
            'type': 'object',
            'properties': {
                'component': {'const': 'Table'},
                'columns': {
                    'type': 'array',
                    'description': 'Column definitions, in display order.',
                    'items': {
                        'type': 'object',
                        'properties': {
                            'key': {
                                'type': 'string',
                                'description': 'Key to look up in each row object.',
                            },
                            'label': {
                                'type': 'string',
                                'description': 'Human-readable column header.',
                            },
                        },
                        'required': ['key', 'label'],
                    },
                },
                'rows': {
                    'type': 'array',
                    'description': (
                        \"Row data. Each row is an object keyed by column 'key'.\"
                    ),
                    'items': {'type': 'object'},
                },
            },
            'required': ['component', 'columns', 'rows'],
        },
    ],
    'unevaluatedProperties': False,
}

catalog['\$defs']['anyComponent']['oneOf'].append({'\$ref': '#/components/Table'})

with open('catalog/dynamic_ui_catalog.json', 'w', encoding='utf-8') as f:
    json.dump(catalog, f, indent=2)
    f.write('\n')

print('Wrote catalog with', len(catalog['components']), 'components')
"
```
Expected: prints `Wrote catalog with 19 components`.

- [ ] **Step 2: Verify the catalog loads and validates through `A2uiSchemaManager`**

Run:
```bash
cd /Users/namdarmesri/Projects/dynamic-ui/backend && uv run python -c "
from a2ui.schema.manager import A2uiSchemaManager, CatalogConfig
from a2ui.schema.constants import VERSION_0_9

manager = A2uiSchemaManager(
    version=VERSION_0_9,
    catalogs=[CatalogConfig.from_path(name='dynamic-ui', catalog_path='catalog/dynamic_ui_catalog.json')],
)
prompt = manager.generate_system_prompt(role_description='test', include_schema=True)
print('Contains Table:', 'Table' in prompt)
print('supported_catalog_ids:', manager.supported_catalog_ids)
"
```
Expected: `Contains Table: True` and `supported_catalog_ids: ['dynamic-ui-catalog']`.

- [ ] **Step 3: Commit**

```bash
cd /Users/namdarmesri/Projects/dynamic-ui && git add backend/catalog/dynamic_ui_catalog.json
git commit -m "Add custom A2UI catalog: basic catalog + Table component"
```

---

### Task 5: `agent.py` — `DynamicUIAgent` (Gemini + tool-calling, no ADK)

**Files:**
- Create: `backend/agent.py`

**Interfaces:**
- Consumes: `CsvTools` (Task 3), `catalog/dynamic_ui_catalog.json` (Task 4).
- Produces: `DynamicUIAgent(csv_tools: CsvTools, model_name: str = "gemini-3-flash-preview")` with:
  - `.answer(query: str) -> tuple[str, Optional[list[dict]]]` — returns `(reply_text, a2ui_messages_or_None)`.
  - `.agent_card -> a2a.types.AgentCard` (built once at init).
  - `.catalog_id -> str` (the resolved catalog's id, for `agent_executor.py`).

**Important implementation detail found during planning:** `A2uiSchemaManager.generate_system_prompt(..., include_schema=True)` automatically injects `DEFAULT_WORKFLOW_RULES`, which instructs the model to use the `<a2ui-json>` tag convention — this actively conflicts with our tool-call convention (verified live: with `generate_system_prompt`, the model ignored the declared tool and emitted tagged text instead). The fix is to build the system prompt manually, calling `selected_catalog.render_as_llm_instructions()` directly and supplying our own workflow description that mandates the tool call — this was verified live and works correctly.

- [ ] **Step 1: Write `agent.py`**

```python
"""DynamicUIAgent: answers CSV questions via Gemini, no Google ADK.

The model is given CSV-query tools plus a `send_a2ui_json_to_client` tool
(re-implementing the mechanism from a2ui's ADK-only
`a2ui.adk.send_a2ui_to_client_toolset` directly against google-genai's
function-calling, since that module is hard-coupled to google.adk classes).
"""

import os
from pathlib import Path
from typing import Any, Optional

from a2a.types import AgentCapabilities, AgentCard, AgentSkill
from a2ui.a2a.extension import get_a2ui_agent_extension
from a2ui.parser.payload_fixer import parse_and_fix
from a2ui.schema.constants import VERSION_0_9
from a2ui.schema.manager import A2uiSchemaManager, CatalogConfig
from google import genai
from google.genai import types

from tools import CsvTools

CATALOG_PATH = str(Path(__file__).parent / "catalog" / "dynamic_ui_catalog.json")


class DynamicUIAgent:
    """Answers questions about a CSV dataset, rendering answers as A2UI UI."""

    def __init__(
        self,
        csv_tools: CsvTools,
        base_url: str,
        model_name: str = "gemini-3-flash-preview",
    ):
        self._csv_tools = csv_tools
        self._model_name = model_name
        self._client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])

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

    def _build_system_prompt(self) -> str:
        role_description = (
            "You are a data assistant that answers questions about a CSV"
            " dataset."
        )
        workflow_description = (
            "To answer, first call describe_columns and/or query_data as"
            " needed. Then render your answer as UI by calling the"
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
            id="answer_csv_questions",
            name="Answer CSV Questions",
            description="Answers questions about a CSV dataset, rendering results as UI.",
            tags=["csv", "data"],
            examples=["Show me the electronics products sorted by price, as a table."],
        )
        return AgentCard(
            name="Dynamic UI Agent",
            description="Answers questions about a CSV dataset with rendered UI.",
            url=base_url,
            version="0.1.0",
            default_input_modes=["text", "text/plain"],
            default_output_modes=["text", "text/plain"],
            capabilities=AgentCapabilities(streaming=False, extensions=[extension]),
            skills=[skill],
        )

    def answer(self, query: str) -> tuple[str, Optional[list[dict[str, Any]]]]:
        """Answers one question. Returns (reply_text, a2ui_messages_or_None)."""
        captured: dict[str, Any] = {}

        def send_a2ui_json_to_client(a2ui_json: str) -> dict:
            """Sends A2UI JSON to the client to render rich UI for the user.

            Call this exactly once per turn with a valid A2UI JSON array of
            messages.

            Args:
              a2ui_json: Valid A2UI JSON (a JSON array of messages) to send
                to the client.
            """
            try:
                payload = parse_and_fix(a2ui_json)
                self._catalog.validator.validate(payload)
                captured["payload"] = payload
                return {"validated_a2ui_json": payload}
            except Exception as e:
                return {"error": f"Failed to validate A2UI JSON: {e}"}

        response = self._client.models.generate_content(
            model=self._model_name,
            contents=query,
            config=types.GenerateContentConfig(
                system_instruction=self._system_prompt,
                tools=[
                    self._csv_tools.describe_columns,
                    self._csv_tools.query_data,
                    send_a2ui_json_to_client,
                ],
            ),
        )
        return response.text or "", captured.get("payload")
```

- [ ] **Step 2: Verify live against real Gemini**

Run (uses the fixture CSV and the real `GEMINI_API_KEY` already in your shell environment):
```bash
cd /Users/namdarmesri/Projects/dynamic-ui/backend && uv run python -c "
import json
from csv_store import load_dataframe
from tools import CsvTools
from agent import DynamicUIAgent

agent = DynamicUIAgent(CsvTools(load_dataframe('sample_data.csv')), base_url='http://localhost:8000')
text, payload = agent.answer('Show me the electronics products sorted by price, as a table.')
print('TEXT:', text)
print('PAYLOAD MESSAGES:', len(payload) if payload else 0)
if payload:
    print(json.dumps(payload, indent=2)[:1500])
"
```
Expected: `TEXT:` a short one-sentence reply; `PAYLOAD MESSAGES: 2` (a `createSurface` and an `updateComponents` message); the printed JSON contains `"component": "Table"` with the 3 Electronics rows.

- [ ] **Step 3: Commit**

```bash
cd /Users/namdarmesri/Projects/dynamic-ui && git add backend/agent.py
git commit -m "Add DynamicUIAgent: Gemini + tool-calling agent loop, no ADK"
```

---

### Task 6: `agent_executor.py` — A2A executor wiring

**Files:**
- Create: `backend/agent_executor.py`

**Interfaces:**
- Consumes: `DynamicUIAgent.answer(query: str) -> tuple[str, Optional[list[dict]]]`, `DynamicUIAgent.agent_card` (Task 5).
- Produces: `DynamicUIAgentExecutor(agent: DynamicUIAgent)` implementing `a2a.server.agent_execution.AgentExecutor`.

**Note:** unlike `restaurant_finder`'s executor, this one has no client-event/booking-flow branch (no follow-up actions in scope) and no streaming loop (single `TaskState.completed` update). When wrapping the A2UI payload, each message in the list gets its own `Part` via `create_a2ui_part` — verified this is the correct convention by reading `a2ui.a2a.parts.parse_response_to_parts`, which does the same `for message in json_data: parts.append(create_a2ui_part(message, ...))` loop for list payloads.

- [ ] **Step 1: Write `agent_executor.py`**

```python
"""A2A AgentExecutor wiring DynamicUIAgent into request handling."""

import logging

from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events import EventQueue
from a2a.server.tasks import TaskUpdater
from a2a.types import Part, Task, TaskState, TextPart, UnsupportedOperationError
from a2a.utils import new_agent_parts_message, new_task
from a2a.utils.errors import ServerError
from a2ui.a2a.extension import try_activate_a2ui_extension
from a2ui.a2a.parts import create_a2ui_part

from agent import DynamicUIAgent

logger = logging.getLogger(__name__)


class DynamicUIAgentExecutor(AgentExecutor):
    """One text query in, one completed A2A response out."""

    def __init__(self, agent: DynamicUIAgent):
        self._agent = agent

    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        query = context.get_user_input()
        active_ui_version = try_activate_a2ui_extension(
            context, self._agent.agent_card
        )
        logger.info(f"Query: {query!r}, A2UI active: {bool(active_ui_version)}")

        text, a2ui_messages = self._agent.answer(query)

        parts: list[Part] = [Part(root=TextPart(text=text))]
        if active_ui_version and a2ui_messages:
            for message in a2ui_messages:
                parts.append(create_a2ui_part(message, version=active_ui_version))

        task = context.current_task
        if not task:
            task = new_task(context.message)
            await event_queue.enqueue_event(task)
        updater = TaskUpdater(event_queue, task.id, task.context_id)

        await updater.update_status(
            TaskState.completed,
            new_agent_parts_message(parts, task.context_id, task.id),
            final=True,
        )

    async def cancel(self, request: RequestContext, event_queue: EventQueue) -> Task | None:
        raise ServerError(error=UnsupportedOperationError())
```

- [ ] **Step 2: Verify it imports cleanly**

Run:
```bash
cd /Users/namdarmesri/Projects/dynamic-ui/backend && uv run python -c "from agent_executor import DynamicUIAgentExecutor; print('OK')"
```
Expected: `OK` (full behavioral verification happens in Task 7, once the server can actually run).

- [ ] **Step 3: Commit**

```bash
cd /Users/namdarmesri/Projects/dynamic-ui && git add backend/agent_executor.py
git commit -m "Add A2A AgentExecutor for DynamicUIAgent"
```

---

### Task 7: `__main__.py` — serve the agent, verify end-to-end over HTTP

**Files:**
- Create: `backend/__main__.py`

**Interfaces:**
- Consumes: `DynamicUIAgent`, `DynamicUIAgentExecutor`, `CsvTools`, `load_dataframe` (Tasks 2, 3, 5, 6).
- Produces: a running A2A server on `http://localhost:8000`.

- [ ] **Step 1: Write `__main__.py`**

```python
"""Entrypoint: loads the CSV, builds the agent, serves it over A2A."""

import logging
import os

import click
import uvicorn
from a2a.server.apps import A2AStarletteApplication
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import InMemoryTaskStore
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware

from agent import DynamicUIAgent
from agent_executor import DynamicUIAgentExecutor
from csv_store import CsvLoadError, load_dataframe
from tools import CsvTools

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

        csv_path = os.getenv("CSV_PATH", "sample_data.csv")
        try:
            dataframe = load_dataframe(csv_path)
        except CsvLoadError as e:
            raise MissingConfigError(str(e)) from e

        base_url = f"http://{host}:{port}"
        model_name = os.getenv("GEMINI_MODEL", "gemini-3-flash-preview")

        agent = DynamicUIAgent(
            CsvTools(dataframe), base_url=base_url, model_name=model_name
        )
        agent_executor = DynamicUIAgentExecutor(agent)

        request_handler = DefaultRequestHandler(
            agent_executor=agent_executor,
            task_store=InMemoryTaskStore(),
        )
        server = A2AStarletteApplication(
            agent_card=agent.agent_card, http_handler=request_handler
        )
        app = server.build()
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

- [ ] **Step 2: Set up `.env` and start the server**

```bash
cd /Users/namdarmesri/Projects/dynamic-ui/backend
printf 'GEMINI_API_KEY=%s\nCSV_PATH=sample_data.csv\nGEMINI_MODEL=gemini-3-flash-preview\n' "$GEMINI_API_KEY" > .env
```
(Do not print `.env`'s contents afterward — it contains the live API key.)

Start the server in the background (this is the exact command verified working for `restaurant_finder`'s identical `__main__.py` shape earlier in this project):
```bash
cd /Users/namdarmesri/Projects/dynamic-ui/backend && uv run .
```
Leave this running — Tasks 10 and 12 need it up.

- [ ] **Step 3: Verify the agent card is served**

Run:
```bash
curl -s http://localhost:8000/.well-known/agent-card.json | head -c 500
```
Expected: JSON containing `"name":"Dynamic UI Agent"` and an extension URI `"https://a2ui.org/a2a-extension/a2ui/v0.9"`.

- [ ] **Step 4: Verify a real question produces text + A2UI data parts**

Run:
```bash
curl -s http://localhost:8000 \
  -H 'Content-Type: application/json' \
  -H 'X-A2A-Extensions: https://a2ui.org/a2a-extension/a2ui/v0.9' \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "message/send",
    "params": {
      "message": {
        "role": "user",
        "parts": [{"kind": "text", "text": "Show me the electronics products sorted by price, as a table."}],
        "messageId": "1"
      }
    }
  }' | python3 -m json.tool
```
Expected: a completed Task whose `status.message.parts` includes one `TextPart` and two `DataPart`s (one `createSurface`, one `updateComponents` with a `"component": "Table"` entry).

- [ ] **Step 5: Commit**

```bash
cd /Users/namdarmesri/Projects/dynamic-ui && git add backend/__main__.py
git commit -m "Add A2A server entrypoint; backend verified end-to-end over HTTP"
```

---

### Task 8: Scaffold frontend Next.js project

**Files:**
- Create: `frontend/` (via `create-next-app`)

**Interfaces:**
- Produces: a Next.js (App Router, TypeScript) project with `@a2ui/react`, `@a2ui/web_core`, `@a2a-js/sdk`, `zod` installed.

- [ ] **Step 1: Scaffold with create-next-app**

```bash
cd /Users/namdarmesri/Projects/dynamic-ui && npx create-next-app@latest frontend \
  --typescript --tailwind --eslint --app --no-src-dir \
  --import-alias "@/*" --use-npm
```
Expected: creates `frontend/` with `app/page.tsx`, `package.json`, etc., no prompts left unanswered (all flags supplied).

- [ ] **Step 2: Install A2UI + A2A dependencies**

```bash
cd /Users/namdarmesri/Projects/dynamic-ui/frontend && npm install @a2ui/react@^0.10 @a2ui/web_core@^0.10 @a2a-js/sdk@^0.3 zod@^3.25
```

- [ ] **Step 3: Verify the dev server boots**

Run:
```bash
cd /Users/namdarmesri/Projects/dynamic-ui/frontend && npx next build
```
Expected: build succeeds with no type errors (confirms the new dependencies don't conflict with the scaffolded TypeScript config).

- [ ] **Step 4: Commit**

```bash
cd /Users/namdarmesri/Projects/dynamic-ui && git add frontend/
git commit -m "Scaffold Next.js frontend with A2UI/A2A dependencies"
```

---

### Task 9: Custom `Table` component + catalog wiring

**Files:**
- Create: `frontend/components/catalog/table.tsx`
- Create: `frontend/components/catalog/catalog.ts`

**Interfaces:**
- Produces: `dynamicUiCatalog: Catalog<ReactComponentImplementation>` with id `"dynamic-ui-catalog"` (matching Task 4's backend catalog exactly), containing every basic-catalog component plus the custom `Table`.

- [ ] **Step 1: Write `table.tsx`**

```tsx
'use client';

import { z } from 'zod';
import { createComponentImplementation } from '@a2ui/react/v0_9';
import type { ComponentApi } from '@a2ui/web_core/v0_9';

export const TableApi = {
  name: 'Table',
  schema: z.object({
    columns: z
      .array(z.object({ key: z.string(), label: z.string() }))
      .describe('Column definitions, in display order.'),
    rows: z
      .array(z.record(z.any()))
      .describe("Row data. Each row is an object keyed by column 'key'."),
  }),
} satisfies ComponentApi;

export const Table = createComponentImplementation(TableApi, ({ props }) => (
  <table className="a2ui-table">
    <thead>
      <tr>
        {props.columns.map((c) => (
          <th key={c.key} className="a2ui-table-th">
            {c.label}
          </th>
        ))}
      </tr>
    </thead>
    <tbody>
      {props.rows.map((row, i) => (
        <tr key={i}>
          {props.columns.map((c) => (
            <td key={c.key} className="a2ui-table-td">
              {String(row[c.key] ?? '')}
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  </table>
));
```

- [ ] **Step 2: Write `catalog.ts`**

```ts
import { Catalog } from '@a2ui/web_core/v0_9';
import { basicCatalog } from '@a2ui/react/v0_9';
import type { ReactComponentImplementation } from '@a2ui/react/v0_9';
import { Table } from './table';

export const dynamicUiCatalog = new Catalog<ReactComponentImplementation>(
  'dynamic-ui-catalog',
  [...basicCatalog.components.values(), Table],
);
```

- [ ] **Step 3: Verify it type-checks**

Run:
```bash
cd /Users/namdarmesri/Projects/dynamic-ui/frontend && npx tsc --noEmit
```
Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/namdarmesri/Projects/dynamic-ui && git add frontend/components/catalog/
git commit -m "Add custom Table component and combined catalog"
```

---

### Task 10: `app/api/agent/route.ts` — server-side A2A proxy

**Files:**
- Create: `frontend/app/api/agent/route.ts`

**Interfaces:**
- Consumes: the running backend at `http://localhost:8000` (Task 7).
- Produces: `POST /api/agent` accepting `{query: string}`, returning `{text: string, a2uiMessages: object[]}` on success or `{error: string}` (HTTP 502) if the backend is unreachable.

- [ ] **Step 1: Write `route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { A2AClient } from '@a2a-js/sdk/client';
import type { MessageSendParams, Part, SendMessageSuccessResponse, Task } from '@a2a-js/sdk';

const AGENT_CARD_URL = 'http://localhost:8000/.well-known/agent-card.json';
const A2UI_EXTENSION = 'https://a2ui.org/a2a-extension/a2ui/v0.9';

let clientPromise: Promise<A2AClient> | null = null;

function getClient(): Promise<A2AClient> {
  if (!clientPromise) {
    const fetchWithExtensionHeader: typeof fetch = (url, init) => {
      const headers = new Headers(init?.headers);
      headers.set('X-A2A-Extensions', A2UI_EXTENSION);
      return fetch(url, { ...init, headers });
    };
    clientPromise = A2AClient.fromCardUrl(AGENT_CARD_URL, {
      fetchImpl: fetchWithExtensionHeader,
    });
  }
  return clientPromise;
}

export async function POST(request: NextRequest) {
  const { query } = await request.json();

  let client: A2AClient;
  try {
    client = await getClient();
  } catch {
    clientPromise = null;
    return NextResponse.json(
      { error: 'Could not reach the agent server at localhost:8000.' },
      { status: 502 },
    );
  }

  const sendParams: MessageSendParams = {
    message: {
      messageId: crypto.randomUUID(),
      role: 'user',
      parts: [{ kind: 'text', text: query } as Part],
      kind: 'message',
    },
  };

  let response: SendMessageSuccessResponse;
  try {
    response = (await client.sendMessage(sendParams)) as SendMessageSuccessResponse;
  } catch {
    return NextResponse.json(
      { error: 'Could not reach the agent server at localhost:8000.' },
      { status: 502 },
    );
  }

  const result = response.result as Task;
  const parts: Part[] =
    result.kind === 'task' ? result.status.message?.parts ?? [] : [];

  let text = '';
  const a2uiMessages: object[] = [];
  for (const part of parts) {
    if (part.kind === 'text') {
      text += part.text;
    } else if (part.kind === 'data') {
      a2uiMessages.push(part.data as object);
    }
  }

  return NextResponse.json({ text, a2uiMessages });
}
```

- [ ] **Step 2: Verify against the running backend**

With the backend from Task 7 still running, start the frontend dev server and leave it running (Task 11 and Task 12 need it up too):
```bash
cd /Users/namdarmesri/Projects/dynamic-ui/frontend && npx next dev &
sleep 5
curl -s -X POST http://localhost:3000/api/agent \
  -H 'Content-Type: application/json' \
  -d '{"query": "Show me the electronics products sorted by price, as a table."}' | python3 -m json.tool
```
Expected: JSON with a non-empty `text` and `a2uiMessages` containing 2 entries (`createSurface`, `updateComponents` with a `Table` component).

- [ ] **Step 3: Commit**

```bash
cd /Users/namdarmesri/Projects/dynamic-ui && git add frontend/app/api/agent/route.ts
git commit -m "Add Next.js API route proxying to the A2A agent"
```

---

### Task 11: `app/page.tsx` — chat UI

**Files:**
- Modify: `frontend/app/page.tsx` (replace the scaffolded default content)

**Interfaces:**
- Consumes: `dynamicUiCatalog` (Task 9), `POST /api/agent` (Task 10).

- [ ] **Step 1: Write `page.tsx`**

```tsx
'use client';

import { useMemo, useRef, useState } from 'react';
import { MessageProcessor } from '@a2ui/web_core/v0_9';
import type { SurfaceModel } from '@a2ui/web_core/v0_9';
import { A2uiSurface } from '@a2ui/react/v0_9';
import type { ReactComponentImplementation } from '@a2ui/react/v0_9';
import { dynamicUiCatalog } from '@/components/catalog/catalog';

type ChatMessage = { role: 'user' | 'agent'; text: string };

export default function Home() {
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [surface, setSurface] = useState<SurfaceModel<ReactComponentImplementation> | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const processor = useMemo(() => {
    const p = new MessageProcessor<ReactComponentImplementation>([dynamicUiCatalog]);
    p.onSurfaceCreated((s) => setSurface(s));
    return p;
  }, []);
  const processorRef = useRef(processor);
  processorRef.current = processor;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim() || loading) return;

    const userQuery = query;
    setMessages((prev) => [...prev, { role: 'user', text: userQuery }]);
    setQuery('');
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: userQuery }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? 'The agent request failed.');
        return;
      }

      if (data.text) {
        setMessages((prev) => [...prev, { role: 'agent', text: data.text }]);
      }
      if (data.a2uiMessages?.length) {
        processorRef.current.processMessages(data.a2uiMessages);
      }
    } catch {
      setError('Could not reach the agent.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
      <h1 className="text-xl font-semibold">Dynamic UI Chatbot</h1>

      <div className="flex flex-col gap-2">
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'font-medium' : 'text-gray-700'}>
            <span className="mr-2 text-sm uppercase text-gray-400">{m.role}</span>
            {m.text}
          </div>
        ))}
      </div>

      {error && <div className="rounded bg-red-100 p-2 text-red-800">{error}</div>}

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          className="flex-1 rounded border p-2"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask a question about the data..."
          disabled={loading}
        />
        <button
          type="submit"
          className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
          disabled={loading}
        >
          {loading ? 'Asking...' : 'Ask'}
        </button>
      </form>

      <div className="rounded border p-4">
        {surface ? <A2uiSurface surface={surface} /> : (
          <p className="text-gray-400">Ask a question to see it rendered here.</p>
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Verify it type-checks and builds**

Run:
```bash
cd /Users/namdarmesri/Projects/dynamic-ui/frontend && npx tsc --noEmit && npx next build
```
Expected: no type errors, build succeeds.

- [ ] **Step 3: Commit**

```bash
cd /Users/namdarmesri/Projects/dynamic-ui && git add frontend/app/page.tsx
git commit -m "Add chat UI wiring MessageProcessor and A2uiSurface"
```

---

### Task 12: Top-level README + full manual end-to-end smoke test

**Files:**
- Create: `README.md` (top-level, at `/Users/namdarmesri/Projects/dynamic-ui/README.md`)

**Interfaces:**
- None — this is the final integration/documentation task.

- [ ] **Step 1: Write the top-level README**

```markdown
# dynamic-ui

A CSV chatbot: ask questions in plain language, get answers rendered as
UI (tables, cards, text) using the [A2UI](https://a2ui.org) protocol. A
Python agent (Gemini, no Google ADK) answers over the A2A protocol; a
Next.js frontend renders the response with the real `@a2ui/react`
renderer.

## Prerequisites

- Python — see `requires-python` in `backend/pyproject.toml`
- [uv](https://docs.astral.sh/uv/)
- Node.js 18+ and npm
- A [Gemini API key](https://aistudio.google.com/apikey)

## Running

1. Backend:
   ```bash
   cd backend
   cp .env.example .env
   # Edit .env with your GEMINI_API_KEY, and CSV_PATH if using your own CSV
   uv sync
   uv run python -m .
   ```
   Serves on `http://localhost:8000`.

2. Frontend (separate terminal):
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
   Open `http://localhost:3000` and ask a question about the CSV data.

## Using your own CSV

Set `CSV_PATH` in `backend/.env` to your CSV file's path. The agent is
domain-agnostic — it inspects your CSV's actual columns at query time via
the `describe_columns`/`query_data` tools, nothing is hardcoded to the
bundled `sample_data.csv` fixture.
```

- [ ] **Step 2: Full manual end-to-end smoke test**

With both the backend (Task 7) and frontend (`npm run dev` in `frontend/`) running:

1. Open `http://localhost:3000` in a browser.
2. Ask: "Show me the electronics products sorted by price, as a table."
3. Confirm: the chat shows a short agent reply, and a `Table` renders below with columns `name/category/price/in_stock` and 3 Electronics rows sorted by price.
4. Ask a second, different-shaped question, e.g. "How many tools are in stock?" — confirm a sensible rendered response (may be a `Text`/`Card` rather than a `Table`, since the model chooses the component).

If both checks pass, the app is verified end-to-end.

- [ ] **Step 3: Commit**

```bash
cd /Users/namdarmesri/Projects/dynamic-ui && git add README.md
git commit -m "Add top-level README; verified end-to-end in browser"
```
