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
