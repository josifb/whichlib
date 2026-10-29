from langchain_core.messages import AIMessage

from app.chat import ChatBot
from drift_fakes import RecordingFakeModel

SYSTEM = ("system", "You are a friendly support agent.")


def conversation(prompt):
    return [(m.type, m.content) for m in prompt]


def test_remembers_each_session_separately():
    model = RecordingFakeModel(
        messages=iter(
            [
                AIMessage(content="Hi Ada! How can I help?"),
                AIMessage(content="Your name is Ada."),
                AIMessage(content="I don't know your name yet."),
            ]
        )
    )
    bot = ChatBot(model)

    assert bot.send("a", "My name is Ada.") == "Hi Ada! How can I help?"
    assert bot.send("a", "What is my name?") == "Your name is Ada."
    assert bot.send("b", "What is my name?") == "I don't know your name yet."

    first, second, other = model.received
    assert conversation(first) == [SYSTEM, ("human", "My name is Ada.")]
    assert conversation(second) == [
        SYSTEM,
        ("human", "My name is Ada."),
        ("ai", "Hi Ada! How can I help?"),
        ("human", "What is my name?"),
    ]
    assert conversation(other) == [SYSTEM, ("human", "What is my name?")]
