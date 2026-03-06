from typing import Literal, Optional

from pydantic import BaseModel

ActionType3D = Literal['MOVE_TCP_TO', 'SET_GRIP', 'GRASP', 'RELEASE', 'WAIT']

class Action3D(BaseModel):
    type: ActionType3D
    x: Optional[float] = None
    y: Optional[float] = None
    z: Optional[float] = None
    width: Optional[float] = None   # meters for SET_GRIP

class SimObject3D(BaseModel):
    id: str
    label: str
    color: str
    shape: str = 'cube'             # 'cube' | 'sphere' | 'cylinder'
    accessible: bool = True
    x: float = 0.0                  # current center x (meters)
    z: float = 0.0                  # current center z (meters)

class TargetBin3D(BaseModel):
    id: str
    label: str
    color: str

class GripperState3D(BaseModel):
    x: float
    y: float
    z: float
    openWidth: float                # meters
    isGrasping: bool
    graspedId: Optional[str] = None

class WorldState3D(BaseModel):
    objects: list[SimObject3D]
    gripper: GripperState3D
    targetBins: list[TargetBin3D]

class VLARequest3D(BaseModel):
    instruction: str
    image: str                      # base64 PNG — perspective view
    image_top: str = ""             # base64 PNG — bird's-eye view (optional)
    state: WorldState3D

class VLAResponse3D(BaseModel):
    actions: list[Action3D]
    reasoning: str
    target_object: Optional[str] = None
    target_bin: Optional[str] = None

class StepHistory3D(BaseModel):
    step: int
    action: dict
    reasoning: str = ""

class StepRequest3D(BaseModel):
    instruction: str
    image: str                      # base64 PNG — perspective view
    image_top: str = ""             # base64 PNG — bird's-eye view (optional)
    state: WorldState3D
    history: list[StepHistory3D] = []
    step: int = 0

class StepResponse3D(BaseModel):
    action: Action3D
    reasoning: str
    is_done: bool
