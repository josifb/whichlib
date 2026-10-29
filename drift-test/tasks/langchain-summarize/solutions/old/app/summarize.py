from langchain.chains import LLMChain
from langchain.prompts import ChatPromptTemplate

prompt = ChatPromptTemplate.from_messages(
    [
        ("system", "Summarize the user's text in one sentence."),
        ("human", "{text}"),
    ]
)


def summarize(model, text: str) -> str:
    chain = LLMChain(llm=model, prompt=prompt)
    return chain.run(text=text)
