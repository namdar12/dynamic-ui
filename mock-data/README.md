# mock-data — synthetic MCP data server

A tiny stand-in for a real data service. It exposes the same tool shape the
`dynamic-ui` agent expects — a `describe_query` discovery tool plus one
`query_<entity>` tool per entity — over an in-memory synthetic dataset
(customers, orders, products). No real data, no database, no network calls.

## Tools

| Tool | Purpose |
|---|---|
| `describe_query(entity)` | Returns an entity's fields + filter grammar. The agent calls this before composing a filter. |
| `query_customers(filter, order_by, limit)` | Filtered reads over 6 synthetic customers. |
| `query_orders(filter, order_by, limit, expand)` | Filtered reads over 10 synthetic orders; `expand='customer'` / `'product'` joins the related row. |
| `query_products(filter, order_by, limit)` | Filtered reads over 5 synthetic products. |

Filter grammar: clauses joined by `and`, each `<field> <op> <value>` with
`<op>` in `=, !=, >, >=, <, <=` — e.g. `total > 100 and status = 'shipped'`.

## Run

```bash
cd mock-data
uv sync
uv run server.py            # serves http://127.0.0.1:8001/mcp/
uv run server.py --port 8002  # custom port
```

Then point the backend at it in `backend/.env`:

```
MCP_DATA_URL=http://localhost:8001/mcp/
```

## Swapping in a real service

Any Streamable-HTTP MCP server exposing `describe_query` + `query_*` tools
works — the agent discovers tools dynamically via `list_tools()` and only
hardcodes the `describe_query` discovery step.
