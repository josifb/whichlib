from langchain.agents import create_agent
from langchain.tools import tool

SYSTEM_PROMPT = "You are a helpful weather assistant."


@tool
def get_weather(city: str) -> str:
    """Get the current weather for a city."""
    return f"It is sunny in {city}"


def build_agent(model):
    return create_agent(model, tools=[get_weather], system_prompt=SYSTEM_PROMPT)


def ask(agent, question: str) -> str:
    result = agent.invoke({"messages": [{"role": "user", "content": question}]})
    return result["messages"][-1].content
