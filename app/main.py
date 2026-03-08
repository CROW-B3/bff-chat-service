from fastapi import FastAPI
from pydantic import BaseModel
from .crew import run_multi_agent_crew

app = FastAPI()


class ChatRequest(BaseModel):
    message: str
    organization_id: str
    conversation_history: list[dict] = []
    api_gateway_url: str
    internal_gateway_key: str = ""


class ReferenceItem(BaseModel):
    index: int
    type: str
    label: str


class ChatResponse(BaseModel):
    response: str
    tools_used: list[str] = []
    references: list[ReferenceItem] = []


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/chat")
async def chat(request: ChatRequest) -> ChatResponse:
    result = await run_multi_agent_crew(
        message=request.message,
        organization_id=request.organization_id,
        conversation_history=request.conversation_history,
        api_gateway_url=request.api_gateway_url,
        internal_gateway_key=request.internal_gateway_key,
    )
    return ChatResponse(
        response=result["response"],
        tools_used=result.get("tools_used", []),
        references=result.get("references", []),
    )
