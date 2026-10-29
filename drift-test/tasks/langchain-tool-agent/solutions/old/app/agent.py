from langchain.agents import AgentExecutor, create_tool_calling_agent
from langchain.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain.tools import tool

SYSTEM_PROMPT = "You are a helpful weather assistant."


@tool
def get_weather(city: str) -> str:
    """Get the current weather for a city."""
    return f"It is sunny in {city}"


def build_agent(model):
    prompt = ChatPromptTemplate.from_messages(
        [
            ("system", SYSTEM_PROMPT),
            ("human", "{input}"),
            MessagesPlaceholder("agent_scratchpad"),
        ]
    )
    agent = create_tool_calling_agent(model, [get_weather], prompt)
    return AgentExecutor(agent=agent, tools=[get_weather])


def ask(agent, question: str) -> str:
    return agent.invoke({"input": question})["output"]
