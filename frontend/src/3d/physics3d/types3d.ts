// 3D coordinate system: Y-up, X-right, Z-toward-camera
// Units: meters

export const TABLE_Y   = 0           // table surface
export const TRANSIT_Y = 0.40        // safe transit height
export const PICK_Y    = 0.04        // object resting center y
export const OBJ_HALF  = 0.04        // half-size of cube/sphere radius
export const GRIPPER_OPEN_W  = 0.10  // meters, fully open
export const GRIPPER_CLOSE_W = 0.02  // meters, fully closed
export const MOVE_SPEED = 0.006      // m/step interpolation speed

// Bin layout (back of table, z=0.55)
export const BIN_Z   = 0.55
export const BIN_XS  = [-0.35, 0, 0.35]

export type ObjectShape3D = 'cube' | 'sphere' | 'cylinder'
export type ActionType3D  = 'MOVE_TCP_TO' | 'SET_GRIP' | 'GRASP' | 'RELEASE' | 'WAIT'

export interface Action3D {
  type: ActionType3D
  x?: number
  y?: number
  z?: number
  width?: number   // meters, for SET_GRIP
}

export interface SimObject3D {
  id: string
  label: string
  color: string
  shape: ObjectShape3D
  accessible: boolean
  x: number   // current center x (meters)
  z: number   // current center z (meters)
}

export interface TargetBin3D {
  id: string
  label: string
  color: string
}

export interface GripperState3D {
  x: number; y: number; z: number
  openWidth: number
  isGrasping: boolean
  graspedId: string | null
}

export interface WorldState3D {
  objects: SimObject3D[]
  gripper: GripperState3D
  targetBins: TargetBin3D[]
}

export interface CaptureImages {
  perspective: string  // base64 PNG — perspective view (for color/shape identification)
  topdown: string      // base64 PNG — bird's-eye view (for precise x,z position)
}

export interface Metrics {
  successRate: number
  avgSteps: number
  dropCount: number
  collisionCount: number
  totalEpisodes: number
  successCount: number
  totalSteps: number
}
