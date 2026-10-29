"""A chat model for tests: replies with the given messages in order and records every prompt it is sent."""

from typing import Any

from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import BaseMessage
from pydantic import Field


class RecordingFakeModel(GenericFakeChatModel):
    received: list[list[BaseMessage]] = Field(default_factory=list)

    def bind_tools(self, tools: Any, **kwargs: Any) -> "RecordingFakeModel":
        return self

    def _generate(self, messages: list[BaseMessage], stop: Any = None, run_manager: Any = None, **kwargs: Any) -> Any:
        self.received.append(list(messages))
        return super()._generate(messages, stop=stop, run_manager=run_manager, **kwargs)
