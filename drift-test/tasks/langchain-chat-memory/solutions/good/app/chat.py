from langchain.agents import create_agent
from langgraph.checkpoint.memory import InMemorySaver

SYSTEM_PROMPT = "You are a friendly support agent."


class ChatBot:
    def __init__(self, model):
        self.agent = create_agent(model, tools=[], system_prompt=SYSTEM_PROMPT, checkpointer=InMemorySaver())

    def send(self, session_id: str, text: str) -> str:
        result = self.agent.invoke(
            {"messages": [{"role": "user", "content": text}]},
            {"configurable": {"thread_id": session_id}},
        )
        return result["messages"][-1].content
