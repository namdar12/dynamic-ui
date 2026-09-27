# backend — Dynamic UI agent (Python)

A2A server (uvicorn + `a2a-sdk`) hosting `DynamicUIAgent`: Gemini, called
directly via `google-genai` (no Google ADK), answers questions over a live MCP
data server and renders answers as A2UI UI.

## How it works

- On startup (`__main__.py`'s Starlette lifespan hook) the agent opens a
  persistent MCP session to `MCP_DATA_URL`, calls `list_tools()`, and converts
  each tool's JSON Schema into a Gemini `FunctionDeclaration` via the public
  `parameters_json_schema` field.
- `agent.py`'s `answer()` runs a hand-rolled tool-calling loop. Automatic
  function calling is disabled: `generate_content` deep-copies the request
  config, and a live MCP `ClientSession` holds an unpicklable
  `asyncio.Future`, so passing the session to automatic dispatch crashes.
  Dispatching manually sidesteps this.
- The system prompt names exactly one discovery tool, `describe_query` — the
  model calls it to learn an entity's fields and filter grammar, then calls
  the discovered `query_*` tools. Entity names are never hardcoded.
- The model renders its answer by calling the `send_a2ui_json_to_client` tool
  exactly once; the payload is validated against
  `catalog/dynamic_ui_catalog.json` before being returned as A2A `DataPart`s.

## Run

```bash
cd backend
cp .env.example .env     # then set GEMINI_API_KEY
uv sync
uv run .                 # serves http://localhost:8000
```

The MCP data server must be reachable at `MCP_DATA_URL` — e.g. the bundled
mock server: `cd ../mock-data && uv run server.py`.

## Configuration

| Variable | Required | Default |
|---|---|---|
| `GEMINI_API_KEY` | yes | — |
| `MCP_DATA_URL` | yes | — |
| `GEMINI_MODEL` | no | `gemini-3-flash-preview` |
