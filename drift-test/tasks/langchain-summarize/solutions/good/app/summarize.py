from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate

prompt = ChatPromptTemplate.from_messages(
    [
        ("system", "Summarize the user's text in one sentence."),
        ("human", "{text}"),
    ]
)


def summarize(model, text: str) -> str:
    return (prompt | model | StrOutputParser()).invoke({"text": text})
