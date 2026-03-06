"""
VLA Pick&Place Simulator — FastAPI Backend
"""
import os
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Security
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.security import APIKeyHeader
from fastapi.staticfiles import StaticFiles

from models import StepRequest, StepResponse, VLARequest, VLAResponse
from models3d import StepRequest3D, StepResponse3D, VLARequest3D, VLAResponse3D

app = FastAPI(title="VLA Simulator API", version="0.1.0")
router = APIRouter(prefix="/api")

_allowed_origin = os.getenv("ALLOWED_ORIGIN", "*")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[_allowed_origin],
    allow_methods=["*"],
    allow_headers=["*"],
)

_api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)

def verify_api_key(key: Optional[str] = Security(_api_key_header)):
    expected = os.getenv("APP_API_KEY")
    if expected and key != expected:
        raise HTTPException(status_code=403, detail="Invalid API key")


@router.get("/health")
def health():
    has_key = bool(os.getenv("ANTHROPIC_API_KEY"))
    return {"status": "ok", "claude_available": has_key}


@router.post("/vla/plan", response_model=VLAResponse, dependencies=[Depends(verify_api_key)])
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


@router.post("/vla/step", response_model=StepResponse, dependencies=[Depends(verify_api_key)])
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


@router.post("/vla3d/plan", response_model=VLAResponse3D, dependencies=[Depends(verify_api_key)])
def vla3d_plan(req: VLARequest3D) -> VLAResponse3D:
    if not req.instruction.strip():
        raise HTTPException(status_code=400, detail="instruction is empty")
    if not os.getenv("ANTHROPIC_API_KEY"):
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY is not set")
    try:
        from claude_vla3d import run_claude_plan3d
        return run_claude_plan3d(req)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Claude error: {e}")


@router.post("/vla3d/step", response_model=StepResponse3D, dependencies=[Depends(verify_api_key)])
def vla3d_step(req: StepRequest3D) -> StepResponse3D:
    if not req.instruction.strip():
        raise HTTPException(status_code=400, detail="instruction is empty")
    if not os.getenv("ANTHROPIC_API_KEY"):
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY is not set")
    try:
        from claude_vla3d import run_claude_step3d
        return run_claude_step3d(req)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Claude error: {e}")


app.include_router(router)

# --- Static file serving (production) ---
_static_dir = Path(__file__).parent / "static"
if _static_dir.exists():
    app.mount("/assets", StaticFiles(directory=_static_dir / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_spa(full_path: str):  # noqa: ARG001
        return FileResponse(_static_dir / "index.html")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
