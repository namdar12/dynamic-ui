# dynamic-ui

A data-driven chatbot: ask questions in plain language, get answers rendered as
UI (tables, cards, text) using the [A2UI](https://a2ui.org) protocol. Queries
live data from [lib-data-access](https://github.com/E360-Infra/lib-data-access),
a separate data-access service exposing live MCP endpoints. A Python agent
(Gemini, no Google ADK) answers over the A2A protocol; a Next.js frontend
renders the response with the real `@a2ui/react` renderer.

## Prerequisites

- Python — see `requires-python` in `backend/pyproject.toml`
- [uv](https://docs.astral.sh/uv/)
- Node.js 18+ and npm
- A [Gemini API key](https://aistudio.google.com/apikey)
- [lib-data-access](https://github.com/E360-Infra/lib-data-access) running and reachable (see setup instructions in that repository)

## Running

1. Backend:
   ```bash
   cd backend
   cp .env.example .env
   # Edit .env with your GEMINI_API_KEY
   # Ensure LIB_DATA_ACCESS_MCP_URL points to the running lib-data-access instance
   uv sync
   uv run .
   ```
   Serves on `http://localhost:8000`.

2. Frontend (separate terminal):
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
   Open `http://localhost:3000` and ask a question about the data from lib-data-access.

## Data Source

This application queries data from a live `lib-data-access` MCP service
rather than a local CSV file. To point to a different data source, change
the `LIB_DATA_ACCESS_MCP_URL` in `backend/.env` to a different
`lib-data-access` instance's URL.
