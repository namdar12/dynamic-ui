"""Synthetic MCP data server (Streamable-HTTP) for dynamic-ui demos.

Stands in for a real data service: it exposes the same tool shape the agent
expects -- a ``describe_query`` discovery tool plus one ``query_<entity>``
tool per entity -- over a tiny in-memory synthetic dataset (customers,
orders, products). No real data, no database, no network calls.

Run:
    cd mock-data && uv sync && uv run server.py [--host 127.0.0.1 --port 8001]

Then point the backend at it with ``MCP_DATA_URL=http://localhost:8001/mcp/``.
"""

from __future__ import annotations

import re
from typing import Any, Optional

import click
from mcp.server.fastmcp import FastMCP

# ---------------------------------------------------------------------------
# Synthetic dataset. Deliberately fake (public figures + example.com emails);
# safe to publish and sufficient to exercise filters, sorting and joins.
# ---------------------------------------------------------------------------

CUSTOMERS: list[dict[str, Any]] = [
    {"id": 1, "name": "Ada Lovelace", "email": "ada@example.com", "city": "Austin", "tier": "pro"},
    {"id": 2, "name": "Grace Hopper", "email": "grace@example.com", "city": "Seattle", "tier": "enterprise"},
    {"id": 3, "name": "Alan Turing", "email": "alan@example.com", "city": "Denver", "tier": "starter"},
    {"id": 4, "name": "Katherine Johnson", "email": "katherine@example.com", "city": "Austin", "tier": "pro"},
    {"id": 5, "name": "Margaret Hamilton", "email": "margaret@example.com", "city": "Seattle", "tier": "enterprise"},
    {"id": 6, "name": "Tim Berners-Lee", "email": "tim@example.com", "city": "Boston", "tier": "starter"},
]

PRODUCTS: list[dict[str, Any]] = [
    {"id": 1, "name": "Wireless Headphones", "category": "Audio", "price": 129.99},
    {"id": 2, "name": "Smart Watch", "category": "Wearables", "price": 249.99},
    {"id": 3, "name": "USB-C Hub", "category": "Accessories", "price": 49.99},
    {"id": 4, "name": "Mechanical Keyboard", "category": "Accessories", "price": 159.99},
    {"id": 5, "name": "4K Monitor", "category": "Displays", "price": 399.99},
]

ORDERS: list[dict[str, Any]] = [
    {"id": 1, "customer_id": 1, "product_id": 2, "quantity": 1, "total": 249.99, "status": "shipped", "ordered_at": "2026-09-01"},
    {"id": 2, "customer_id": 2, "product_id": 5, "quantity": 2, "total": 799.98, "status": "delivered", "ordered_at": "2026-09-03"},
    {"id": 3, "customer_id": 1, "product_id": 3, "quantity": 3, "total": 149.97, "status": "delivered", "ordered_at": "2026-09-05"},
    {"id": 4, "customer_id": 3, "product_id": 4, "quantity": 1, "total": 159.99, "status": "pending", "ordered_at": "2026-09-08"},
    {"id": 5, "customer_id": 4, "product_id": 1, "quantity": 2, "total": 259.98, "status": "shipped", "ordered_at": "2026-09-10"},
    {"id": 6, "customer_id": 5, "product_id": 2, "quantity": 1, "total": 249.99, "status": "cancelled", "ordered_at": "2026-09-12"},
    {"id": 7, "customer_id": 2, "product_id": 1, "quantity": 1, "total": 129.99, "status": "delivered", "ordered_at": "2026-09-15"},
    {"id": 8, "customer_id": 6, "product_id": 3, "quantity": 1, "total": 49.99, "status": "pending", "ordered_at": "2026-09-18"},
    {"id": 9, "customer_id": 4, "product_id": 5, "quantity": 1, "total": 399.99, "status": "shipped", "ordered_at": "2026-09-20"},
    {"id": 10, "customer_id": 3, "product_id": 1, "quantity": 1, "total": 129.99, "status": "delivered", "ordered_at": "2026-09-22"},
]

TABLES: dict[str, list[dict[str, Any]]] = {
    "customers": CUSTOMERS,
    "orders": ORDERS,
    "products": PRODUCTS,
}

FIELDS: dict[str, dict[str, str]] = {
    "customers": {
        "id": "int",
        "name": "string",
        "email": "string",
        "city": "string",
        "tier": "string (starter | pro | enterprise)",
    },
    "orders": {
        "id": "int",
        "customer_id": "int (FK -> customers.id)",
        "product_id": "int (FK -> products.id)",
        "quantity": "int",
        "total": "number (USD)",
        "status": "string (pending | shipped | delivered | cancelled)",
        "ordered_at": "string (ISO date)",
    },
    "products": {
        "id": "int",
        "name": "string",
        "category": "string",
        "price": "number (USD)",
    },
}

# Relations available through `expand` on query_orders: name -> (fk field, target table).
EXPANDABLE: dict[str, dict[str, tuple[str, list[dict[str, Any]]]]] = {
    "orders": {
        "customer": ("customer_id", CUSTOMERS),
        "product": ("product_id", PRODUCTS),
    },
}

GRAMMAR = (
    "filter: one or more clauses joined by 'and'; each clause is "
    "'<field> <op> <value>' where <op> is one of =, !=, >, >=, <, <= and "
    "<value> is a number or a single-quoted string, e.g. "
    "\"total > 100 and status = 'shipped'\". "
    "order_by: '<field>' or '<field> desc'. "
    "limit: maximum number of rows to return. "
    "expand (orders only): 'customer', 'product', or 'customer,product' to "
    "embed the related row (a join)."
)

_CLAUSE_RE = re.compile(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(=|!=|>=|<=|>|<)\s*(.+?)\s*$")


def _coerce(raw: str) -> Any:
    raw = raw.strip()
    if len(raw) >= 2 and raw[0] == raw[-1] and raw[0] in ("'", '"'):
        return raw[1:-1]
    try:
        return int(raw)
    except ValueError:
        pass
    try:
        return float(raw)
    except ValueError:
        return raw


def _as_number(value: Any) -> Optional[float]:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _compare(have: Any, op: str, want: Any) -> bool:
    have_n, want_n = _as_number(have), _as_number(want)
    if have_n is not None and want_n is not None:
        have, want = have_n, want_n
    elif type(have) is not type(want):
        # Mixed non-numeric types: only equality is meaningful.
        if op == "=":
            return have == want
        if op == "!=":
            return have != want
        return False
    if op == "=":
        return have == want
    if op == "!=":
        return have != want
    try:
        if op == ">":
            return have > want
        if op == ">=":
            return have >= want
        if op == "<":
            return have < want
        if op == "<=":
            return have <= want
    except TypeError:
        return False
    raise AssertionError(f"unreachable op {op!r}")


def _apply_filter(rows: list[dict[str, Any]], filter: str) -> list[dict[str, Any]]:
    if not filter or not filter.strip():
        return list(rows)
    clauses = re.split(r"\s+and\s+", filter.strip(), flags=re.IGNORECASE)
    parsed = []
    for clause in clauses:
        m = _CLAUSE_RE.match(clause)
        if not m:
            raise ValueError(f"cannot parse filter clause: {clause!r}")
        field, op, raw = m.groups()
        parsed.append((field, op, _coerce(raw)))
    result = []
    for row in rows:
        matched = True
        for field, op, want in parsed:
            if field not in row:
                raise ValueError(f"unknown field '{field}'")
            if not _compare(row[field], op, want):
                matched = False
                break
        if matched:
            result.append(row)
    return result


def _apply_order_by(rows: list[dict[str, Any]], order_by: str) -> list[dict[str, Any]]:
    if not order_by or not order_by.strip():
        return rows
    parts = order_by.strip().split()
    field = parts[0]
    desc = len(parts) > 1 and parts[1].lower() == "desc"
    return sorted(rows, key=lambda r: (r.get(field) is None, r.get(field)), reverse=desc)


def _apply_expand(entity: str, rows: list[dict[str, Any]], expand: str) -> list[dict[str, Any]]:
    if not expand or not expand.strip():
        return [dict(r) for r in rows]
    relations = EXPANDABLE.get(entity, {})
    names = [n.strip() for n in expand.split(",") if n.strip()]
    for name in names:
        if name not in relations:
            raise ValueError(f"cannot expand '{name}' on '{entity}'")
    out = []
    for row in rows:
        row = dict(row)
        for name in names:
            fk, table = relations[name]
            row[name] = next((dict(t) for t in table if t["id"] == row.get(fk)), None)
        out.append(row)
    return out


def _query(
    entity: str,
    filter: Optional[str] = None,
    order_by: Optional[str] = None,
    limit: Optional[int] = None,
    expand: Optional[str] = None,
) -> dict[str, Any]:
    rows = _apply_filter(TABLES[entity], filter or "")
    rows = _apply_order_by(rows, order_by or "")
    if limit is not None:
        limit = int(limit)
        if limit < 0:
            raise ValueError("limit must be >= 0")
        rows = rows[:limit]
    rows = _apply_expand(entity, rows, expand or "")
    return {"entity": entity, "count": len(rows), "rows": rows}


def describe_query(entity: str) -> dict[str, Any]:
    """Describe how to query an entity: its fields and the filter grammar.
    Call this before composing a filter for one of the query_* tools."""
    entity = entity.strip().lower()
    if entity not in TABLES:
        raise ValueError(f"unknown entity {entity!r}; known entities: {sorted(TABLES)}")
    return {
        "entity": entity,
        "fields": FIELDS[entity],
        "grammar": GRAMMAR,
        "query_tool": f"query_{entity}",
        "entities": sorted(TABLES),
    }


def query_customers(
    filter: Optional[str] = None,
    order_by: Optional[str] = None,
    limit: Optional[int] = None,
) -> dict[str, Any]:
    """Query customers. Call describe_query('customers') first for fields and filter grammar."""
    return _query("customers", filter, order_by, limit)


def query_orders(
    filter: Optional[str] = None,
    order_by: Optional[str] = None,
    limit: Optional[int] = None,
    expand: Optional[str] = None,
) -> dict[str, Any]:
    """Query orders; expand='customer' and/or 'product' joins the related row.
    Call describe_query('orders') first for fields and filter grammar."""
    return _query("orders", filter, order_by, limit, expand)


def query_products(
    filter: Optional[str] = None,
    order_by: Optional[str] = None,
    limit: Optional[int] = None,
) -> dict[str, Any]:
    """Query products. Call describe_query('products') first for fields and filter grammar."""
    return _query("products", filter, order_by, limit)


def create_server(host: str = "127.0.0.1", port: int = 8001) -> FastMCP:
    """Build the FastMCP server with all tools registered."""
    server = FastMCP("mock-data-server", host=host, port=port)
    server.tool()(describe_query)
    server.tool()(query_customers)
    server.tool()(query_orders)
    server.tool()(query_products)
    return server


@click.command()
@click.option("--host", default="127.0.0.1", show_default=True, help="Interface to bind.")
@click.option("--port", default=8001, show_default=True, type=int, help="Port to listen on.")
def main(host: str, port: int) -> None:
    """Serve the synthetic MCP data server over Streamable-HTTP (/mcp)."""
    create_server(host=host, port=port).run(transport="streamable-http")


if __name__ == "__main__":
    main()
