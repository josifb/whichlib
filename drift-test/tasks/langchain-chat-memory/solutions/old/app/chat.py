from langchain.chains import ConversationChain
from langchain.memory import ConversationBufferMemory
from langchain.prompts import ChatPromptTemplate, MessagesPlaceholder

SYSTEM_PROMPT = "You are a friendly support agent."

prompt = ChatPromptTemplate.from_messages(
    [
        ("system", SYSTEM_PROMPT),
        MessagesPlaceholder("history"),
        ("human", "{input}"),
    ]
)


class ChatBot:
    def __init__(self, model):
        self.model = model
        self.sessions: dict[str, ConversationChain] = {}

    def send(self, session_id: str, text: str) -> str:
        if session_id not in self.sessions:
            memory = ConversationBufferMemory(return_messages=True)
            self.sessions[session_id] = ConversationChain(llm=self.model, memory=memory, prompt=prompt)
        return self.sessions[session_id].predict(input=text)
