"""A2A AgentExecutor wiring DynamicUIAgent into request handling."""

import logging

from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events import EventQueue
from a2a.server.tasks import TaskUpdater
from a2a.types import (
    DataPart,
    Part,
    Task,
    TaskState,
    TextPart,
    UnsupportedOperationError,
)
from a2a.utils import new_agent_parts_message, new_agent_text_message, new_task
from a2a.utils.errors import ServerError
from a2ui.a2a.extension import try_activate_a2ui_extension
from a2ui.a2a.parts import create_a2ui_part

from agent import DynamicUIAgent

logger = logging.getLogger(__name__)

# Marks the DataPart listing the MCP tool calls behind an answer, so clients
# can tell it apart from the A2UI DataParts.
TOOL_CALLS_MIME_TYPE = "application/vnd.dynamic-ui.tool-calls+json"

# Marks the DataPart in each in-progress status update, carrying one finished
# MCP tool call ({"name", "args", "count"?, "failed"?}) while the answer is
# still being worked out.
PROGRESS_MIME_TYPE = "application/vnd.dynamic-ui.progress+json"


class DynamicUIAgentExecutor(AgentExecutor):
    """One text query in: a working status update per tool call, then one
    completed A2A response."""

    def __init__(self, agent: DynamicUIAgent):
        self._agent = agent

    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        query = context.get_user_input()
        active_ui_version = try_activate_a2ui_extension(
            context, self._agent.agent_card
        )
        logger.info(f"Query: {query!r}, A2UI active: {bool(active_ui_version)}")

        task = context.current_task
        if not task:
            task = new_task(context.message)
            await event_queue.enqueue_event(task)
        updater = TaskUpdater(event_queue, task.id, task.context_id)

        async def report_step(step: dict) -> None:
            part = Part(root=DataPart(data=step, metadata={"mimeType": PROGRESS_MIME_TYPE}))
            await updater.update_status(
                TaskState.working,
                new_agent_parts_message([part], task.context_id, task.id),
            )

        try:
            text, a2ui_messages, tool_calls = await self._agent.answer(
                query, on_step=report_step
            )
        except Exception:
            logger.exception("Failed to answer %r", query)
            await updater.failed(
                new_agent_text_message(
                    "The agent hit an error while answering.",
                    task.context_id,
                    task.id,
                )
            )
            return

        parts: list[Part] = [Part(root=TextPart(text=text))]
        if active_ui_version and a2ui_messages:
            for message in a2ui_messages:
                parts.append(create_a2ui_part(message, version=active_ui_version))
        if tool_calls:
            parts.append(
                Part(
                    root=DataPart(
                        data={"toolCalls": tool_calls},
                        metadata={"mimeType": TOOL_CALLS_MIME_TYPE},
                    )
                )
            )

        await updater.update_status(
            TaskState.completed,
            new_agent_parts_message(parts, task.context_id, task.id),
            final=True,
        )

    async def cancel(self, request: RequestContext, event_queue: EventQueue) -> Task | None:
        raise ServerError(error=UnsupportedOperationError())
