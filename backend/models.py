from pydantic import BaseModel
from typing import Optional, Literal

ActionType = Literal['MOVE_TCP_TO', 'SET_GRIP', 'GRASP', 'RELEASE', 'WAIT']

class Action(BaseModel):
    type: ActionType
    x: Optional[float] = None
    y: Optional[float] = None
    width: Optional[float] = None
    ms: Optional[float] = None

class SimObject(BaseModel):
    id: str
    label: str
    color: str
    cx: float
    cy: float
    w: float
    h: float
    shape: str = 'rect'  # 'rect' | 'circle' | 'triangle'
    accessible: bool = True  # 上に別ブロックがなく直接把持可能か

class TargetZone(BaseModel):
    id: str
    label: str
    color: str
    cx: float
    cy: float
    w: float
    h: float

class GripperState(BaseModel):
    cx: float
    cy: float
    openWidth: float
    isGrasping: bool
    graspedId: Optional[str]

class WorldState(BaseModel):
    objects: list[SimObject]
    gripper: GripperState
    targetZones: list[TargetZone]

PolicyMode = Literal["vla", "la"]

class VLARequest(BaseModel):
    instruction: str
    image: str  # base64 PNG
    state: WorldState
    policy_mode: PolicyMode = "la"

class VLAResponse(BaseModel):
    actions: list[Action]
    reasoning: str
    target_object: Optional[str] = None
    target_zone: Optional[str] = None

# --- Closed-loop step API ---

class StepHistory(BaseModel):
    step: int
    action: dict
    reasoning: str = ""

class StepRequest(BaseModel):
    instruction: str
    image: str          # base64 PNG
    state: WorldState
    history: list[StepHistory] = []
    step: int = 0
    policy_mode: PolicyMode = "la"

class StepResponse(BaseModel):
    action: Action
    reasoning: str
    is_done: bool
