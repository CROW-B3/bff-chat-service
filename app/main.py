from fastapi import FastAPI
from pydantic import BaseModel
from .crew import run_chat_crew

app = FastAPI()

class ChatRequest(BaseModel):
    message: str
    organization_id: str
    conversation_history: list[dict] = []
    api_gateway_url: str

class ChatResponse(BaseModel):
    response: str
    tools_used: list[str] = []

@app.get("/health")
def health():
    return {"status": "ok", "service": "crow-chat-crew"}

@app.post("/chat")
async def chat(request: ChatRequest) -> ChatResponse:
    result = await run_chat_crew(
        message=request.message,
        organization_id=request.organization_id,
        conversation_history=request.conversation_history,
        api_gateway_url=request.api_gateway_url,
    )
    return ChatResponse(response=result["response"], tools_used=result.get("tools_used", []))
