from langchain_core.messages import AIMessage, ToolMessage

from app.agent import ask, build_agent
from drift_fakes import RecordingFakeModel


def test_agent_calls_the_weather_tool_and_answers():
    model = RecordingFakeModel(
        messages=iter(
            [
                AIMessage(content="", tool_calls=[{"name": "get_weather", "args": {"city": "Paris"}, "id": "call_1"}]),
                AIMessage(content="It is sunny in Paris today."),
            ]
        )
    )
    agent = build_agent(model)

    assert ask(agent, "What's the weather in Paris?") == "It is sunny in Paris today."

    first, second = model.received
    assert first[0].type == "system"
    assert first[0].content == "You are a helpful weather assistant."
    assert any(m.type == "human" and m.content == "What's the weather in Paris?" for m in first)
    tool_results = [m for m in second if isinstance(m, ToolMessage)]
    assert [m.content for m in tool_results] == ["It is sunny in Paris"]
