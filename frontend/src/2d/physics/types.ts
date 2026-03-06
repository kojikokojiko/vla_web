// Canvas座標系 (px): 原点=左上, Y下向き, 512x512
// Physics座標系 (m): 原点=左下, Y上向き, scale=40px/m

export const CANVAS_W = 512
export const CANVAS_H = 512
export const SCALE = 40 // px/m
export const TABLE_TOP_CY = 440

// Physics <-> Canvas 変換
export const toCanvasX = (px: number) => px * SCALE
export const toCanvasY = (py: number) => CANVAS_H - py * SCALE
export const toPhysX = (cx: number) => cx / SCALE
export const toPhysY = (cy: number) => (CANVAS_H - cy) / SCALE

export type ActionType = 'MOVE_TCP_TO' | 'SET_GRIP' | 'GRASP' | 'RELEASE' | 'WAIT'
export type BlockShape = 'rect' | 'circle' | 'triangle'

export interface Action {
  type: ActionType
  x?: number   // canvas px
  y?: number   // canvas px
  width?: number // grip width in canvas px
  ms?: number   // wait duration
}

export interface SimObject {
  id: string
  label: string
  color: string
  cx: number  // canvas center x
  cy: number  // canvas center y
  w: number   // canvas width (bounding box)
  h: number   // canvas height (bounding box)
  shape: BlockShape
  accessible: boolean  // 上に別ブロックがなく直接把持可能か
}

export interface TargetZone {
  id: string
  label: string
  color: string
  cx: number
  cy: number
  w: number
  h: number
}

export interface GripperState {
  cx: number      // canvas center x
  cy: number      // canvas center y
  openWidth: number  // current open width in canvas px (max=70, min=0)
  isGrasping: boolean
  graspedId: string | null
}

export interface WorldState {
  objects: SimObject[]
  gripper: GripperState
  targetZones: TargetZone[]
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
