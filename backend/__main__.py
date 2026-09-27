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
