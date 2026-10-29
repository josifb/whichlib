from langchain_core.messages import AIMessage

from app.summarize import summarize
from drift_fakes import RecordingFakeModel

TICKET = "The export button does nothing since Monday. I tried {two} browsers and cleared my cache."


def test_summarize_sends_the_system_prompt_and_the_text_and_returns_a_string():
    model = RecordingFakeModel(messages=iter([AIMessage(content="The export button has been broken since Monday.")]))

    summary = summarize(model, TICKET)

    assert summary == "The export button has been broken since Monday."
    assert isinstance(summary, str)
    [prompt] = model.received
    assert [(m.type, m.content) for m in prompt] == [
        ("system", "Summarize the user's text in one sentence."),
        ("human", TICKET),
    ]
