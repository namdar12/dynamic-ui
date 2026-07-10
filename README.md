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
