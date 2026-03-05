"""
VLA Pick&Place Simulator — FastAPI Backend
"""
import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from models import VLARequest, VLAResponse, StepRequest, StepResponse

app = FastAPI(title="VLA Simulator API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    has_key = bool(os.getenv("ANTHROPIC_API_KEY"))
    return {"status": "ok", "claude_available": has_key}


@app.post("/vla/plan", response_model=VLAResponse)
def vla_plan(req: VLARequest) -> VLAResponse:
    """オープンループ: 全アクション列を一括生成。Claude Vision を前提とする。"""
    if not req.instruction.strip():
        raise HTTPException(status_code=400, detail="instruction is empty")
    if not os.getenv("ANTHROPIC_API_KEY"):
        raise HTTPException(
            status_code=500,
            detail="ANTHROPIC_API_KEY is not set; Claude-backed VLA policy is required.",
        )
    try:
        from claude_vla import run_claude_plan
        return run_claude_plan(req)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Claude error: {e}")


@app.post("/vla/step", response_model=StepResponse)
def vla_step(req: StepRequest) -> StepResponse:
    """
    クローズドループ VLA ステップ。
    Claude Vision を前提とする。
    """
    if not req.instruction.strip():
        raise HTTPException(status_code=400, detail="instruction is empty")

    if not os.getenv("ANTHROPIC_API_KEY"):
        raise HTTPException(
            status_code=500,
            detail="ANTHROPIC_API_KEY is not set; Claude-backed VLA policy is required.",
        )

    try:
        from claude_vla import run_claude_step
        return run_claude_step(req)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Claude error: {e}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
