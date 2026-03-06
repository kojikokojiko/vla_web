import * as pl from 'planck'
import {
  CANVAS_W, CANVAS_H, SCALE, TABLE_TOP_CY,
  toCanvasX, toCanvasY, toPhysX, toPhysY,
  SimObject, TargetZone, GripperState, WorldState, Action, Metrics, BlockShape
} from './types'

const BLOCK_SIZE = 44  // デフォルトサイズ (bounding box)
const BLOCK_W = BLOCK_SIZE
const BLOCK_H = BLOCK_SIZE

const PALETTE = [
  { name: 'Red',    hex: '#e74c3c' },
  { name: 'Blue',   hex: '#3498db' },
  { name: 'Green',  hex: '#2ecc71' },
  { name: 'Orange', hex: '#f39c12' },
  { name: 'Purple', hex: '#9b59b6' },
  { name: 'Teal',   hex: '#1abc9c' },
]
const SHAPES: BlockShape[] = ['rect', 'circle', 'triangle']

function shuffle<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5)
}
const GRIPPER_OPEN_W = 70
const GRIPPER_MOVE_SPEED = 6  // px per step

const vec = (x: number, y: number) => pl.Vec2(x, y)

export class VLAWorld {
  private world: pl.World
  private blockBodies: Map<string, pl.Body> = new Map()

  private objects: SimObject[] = []
  private zones: TargetZone[] = []
  private gripper: GripperState = {
    cx: CANVAS_W / 2,
    cy: 100,
    openWidth: GRIPPER_OPEN_W,
    isGrasping: false,
    graspedId: null,
  }

  private actionQueue: Action[] = []
  private currentAction: Action | null = null
  private actionDone = true

  metrics: Metrics = {
    successRate: 0, avgSteps: 0, dropCount: 0,
    collisionCount: 0, totalEpisodes: 0, successCount: 0, totalSteps: 0,
  }
  private stepCount = 0

  constructor() {
    this.world = pl.World({ gravity: vec(0, -20) })
    this.setupStaticBodies()
    this.resetObjects()
  }

  private setupStaticBodies() {
    // Table
    const tableBody = this.world.createBody({ type: 'static' })
    tableBody.setPosition(vec(toPhysX(CANVAS_W / 2), toPhysY(TABLE_TOP_CY + 20)))
    tableBody.createFixture(pl.Box(toPhysX(CANVAS_W / 2), 0.5), { friction: 0.9 })

    // Walls
    const wallHalf = toPhysY(0) / 2
    for (const cx of [0, CANVAS_W]) {
      const w = this.world.createBody({ type: 'static' })
      w.setPosition(vec(toPhysX(cx), wallHalf))
      w.createFixture(pl.Box(0.1, wallHalf), { friction: 0.5 })
    }
  }

  resetObjects() {
    // 掴んでいたオブジェクトを解放
    this.gripper.isGrasping = false
    this.gripper.graspedId = null

    // 既存ブロックを削除
    for (const body of this.blockBodies.values()) {
      this.world.destroyBody(body)
    }
    this.blockBodies.clear()

    const initialObjects = [
      { id: 'red',   label: 'Red Block',   color: '#e74c3c', cx: 120, shape: 'rect'     as BlockShape },
      { id: 'blue',  label: 'Blue Block',  color: '#3498db', cx: 256, shape: 'circle'   as BlockShape },
      { id: 'green', label: 'Green Block', color: '#2ecc71', cx: 392, shape: 'triangle' as BlockShape },
    ]

    this.objects = initialObjects.map(o => {
      const cy = TABLE_TOP_CY - BLOCK_H / 2
      this.createBlockBody(o.id, o.cx, cy, BLOCK_W, BLOCK_H)
      return { id: o.id, label: o.label, color: o.color, cx: o.cx, cy, w: BLOCK_W, h: BLOCK_H, shape: o.shape, accessible: true }
    })

    this.zones = [
      { id: 'zone_a', label: 'Zone A', color: 'rgba(231,76,60,0.25)',  cx: 90,  cy: TABLE_TOP_CY - 5, w: 120, h: 30 },
      { id: 'zone_b', label: 'Zone B', color: 'rgba(52,152,219,0.25)', cx: 256, cy: TABLE_TOP_CY - 5, w: 120, h: 30 },
      { id: 'zone_c', label: 'Zone C', color: 'rgba(46,204,113,0.25)', cx: 422, cy: TABLE_TOP_CY - 5, w: 120, h: 30 },
    ]

    this.gripper.cx = CANVAS_W / 2
    this.gripper.cy = 100
    this.gripper.openWidth = GRIPPER_OPEN_W

    this.actionQueue = []
    this.currentAction = null
    this.actionDone = true
    this.stepCount = 0
  }

  private createBlockBody(id: string, cx: number, cy: number, w: number, h: number) {
    const body = this.world.createBody({ type: 'dynamic', fixedRotation: true })
    body.setPosition(vec(toPhysX(cx), toPhysY(cy)))
    body.setLinearDamping(1.0)
    body.setAngularDamping(2.0)
    body.createFixture(pl.Box(w / 2 / SCALE, h / 2 / SCALE), {
      density: 1.5, friction: 0.9, restitution: 0.05,
    })
    this.blockBodies.set(id, body)
    return body
  }

  randomizeScene(objCount?: number, zoneCount?: number) {
    const nObj  = objCount  ?? Math.floor(Math.random() * 3) + 2   // 2-4
    const nZone = zoneCount ?? Math.floor(Math.random() * 2) + 2   // 2-3

    // グリッパー・キュー リセット
    this.gripper.isGrasping = false
    this.gripper.graspedId = null
    for (const body of this.blockBodies.values()) this.world.destroyBody(body)
    this.blockBodies.clear()

    // ランダムな色・形状を選ぶ
    const colors  = shuffle(PALETTE).slice(0, nObj)
    const shapes  = shuffle(SHAPES)

    // x軸を均等スロットに分割してランダム配置
    const margin = 60
    const slotW  = (CANVAS_W - margin * 2) / nObj
    const ZONE_LABELS = ['Zone A', 'Zone B', 'Zone C', 'Zone D']

    this.objects = colors.map((c, i) => {
      const id    = c.name.toLowerCase()
      const shape = shapes[i % SHAPES.length]
      const cx    = margin + slotW * i + slotW * (0.3 + Math.random() * 0.4)
      const cy    = TABLE_TOP_CY - BLOCK_SIZE / 2
      this.createBlockBody(id, cx, cy, BLOCK_SIZE, BLOCK_SIZE)
      return { id, label: `${c.name} Block`, color: c.hex, cx, cy, w: BLOCK_SIZE, h: BLOCK_SIZE, shape, accessible: true }
    })

    const zoneSlotW = (CANVAS_W - margin * 2) / nZone
    const ZONE_COLORS = [
      'rgba(231,76,60,0.25)', 'rgba(52,152,219,0.25)',
      'rgba(46,204,113,0.25)', 'rgba(155,89,182,0.25)',
    ]
    this.zones = Array.from({ length: nZone }, (_, i) => ({
      id: `zone_${String.fromCharCode(97 + i)}`,
      label: ZONE_LABELS[i],
      color: ZONE_COLORS[i],
      cx: margin + zoneSlotW * i + zoneSlotW / 2,
      cy: TABLE_TOP_CY - 5,
      w: Math.min(zoneSlotW - 20, 140),
      h: 30,
    }))

    this.gripper.cx = CANVAS_W / 2
    this.gripper.cy = 100
    this.gripper.openWidth = GRIPPER_OPEN_W
    this.actionQueue = []
    this.currentAction = null
    this.actionDone = true
    this.stepCount = 0
  }

  enqueueActions(actions: Action[]) {
    this.actionQueue.push(...actions)
  }

  get isIdle() {
    return this.currentAction === null && this.actionQueue.length === 0
  }

  step(dtMs: number) {
    const dt = Math.min(dtMs / 1000, 0.05)
    try {
      this.processAction()
      this.syncGraspedObject()
      // positionIterations を増やして貫通を抑制
      this.world.step(dt, 10, 8)
      this.syncFromPhysics()
    } catch (e) {
      console.error('[VLAWorld.step] error:', e)
    }
  }

  private processAction() {
    if (this.currentAction === null || this.actionDone) {
      if (this.actionQueue.length === 0) {
        this.currentAction = null
        return
      }
      this.currentAction = this.actionQueue.shift()!
      this.actionDone = false
    }

    const act = this.currentAction
    switch (act.type) {
      case 'MOVE_TCP_TO':
        if (act.x == null || act.y == null || !isFinite(act.x) || !isFinite(act.y)) {
          console.warn('[VLAWorld] MOVE_TCP_TO skipped: invalid x/y', act.x, act.y)
          this.actionDone = true
        } else {
          this.actionDone = this.moveTo(act.x, act.y)
        }
        break
      case 'SET_GRIP':
        this.gripper.openWidth = Math.max(0, Math.min(GRIPPER_OPEN_W, act.width ?? GRIPPER_OPEN_W))
        this.actionDone = true
        break
      case 'GRASP':
        this.doGrasp()
        this.actionDone = true
        break
      case 'RELEASE':
        this.doRelease()
        this.actionDone = true
        break
      case 'WAIT':
        this.actionDone = true
        break
    }

    if (this.actionDone) {
      this.stepCount++
      this.currentAction = null
    }
  }

  /**
   * 把持中ブロックの底面が他ブロック or テーブル面に触れる直前の
   * グリッパーTCP最大Y（canvas座標: 値が大きい = 下）を返す
   */
  private getMaxGripperY(tcpX: number, heldObjId: string): number {
    const heldObj = this.objects.find(o => o.id === heldObjId)
    if (!heldObj) return TABLE_TOP_CY

    // テーブル面制限: held_block_bottom = gripper.cy + heldObj.h + 4 <= TABLE_TOP_CY
    let maxY = TABLE_TOP_CY - heldObj.h - 4

    for (const obj of this.objects) {
      if (obj.id === heldObjId) continue
      // X方向の重なり判定 (少しだけ厳しめ: -4px のマージン)
      const xOverlap = Math.abs(obj.cx - tcpX) < (obj.w / 2 + heldObj.w / 2 - 4)
      if (!xOverlap) continue

      // obj の天面 (canvas Y: 小さい = 上)
      const objTop = obj.cy - obj.h / 2
      // held_block_bottom <= objTop → gripper.cy <= objTop - heldObj.h - 4
      const limitY = objTop - heldObj.h - 4
      if (limitY < maxY) maxY = limitY
    }
    return maxY
  }

  private moveTo(targetCx: number, targetCy: number): boolean {
    if (this.gripper.isGrasping && this.gripper.graspedId) {
      // 移動先 & 現在位置の両方で高さ制限を計算し、厳しい方を使う
      const maxYAtTarget  = this.getMaxGripperY(targetCx,         this.gripper.graspedId)
      const maxYAtCurrent = this.getMaxGripperY(this.gripper.cx,  this.gripper.graspedId)
      const maxY = Math.min(maxYAtTarget, maxYAtCurrent)

      // 現在位置が既に制限を超えている場合は即座に引き上げる（貫通回避）
      if (this.gripper.cy > maxY) this.gripper.cy = maxY
      targetCy = Math.min(targetCy, maxYAtTarget)
    }

    const dx = targetCx - this.gripper.cx
    const dy = targetCy - this.gripper.cy
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist < 2) {
      this.gripper.cx = targetCx
      this.gripper.cy = targetCy
      return true
    }
    const spd = Math.min(GRIPPER_MOVE_SPEED, dist)
    this.gripper.cx += (dx / dist) * spd
    this.gripper.cy += (dy / dist) * spd
    return false
  }

  /**
   * 対象ブロックの天面に別のブロックが乗っているか判定する。
   * 乗っている場合は物理的にアクセス不可 → グラスプ不可。
   */
  private isBlockAccessible(objId: string): boolean {
    const obj = this.objects.find(o => o.id === objId)
    if (!obj) return false
    const objTop = obj.cy - obj.h / 2  // canvas Y (小さい = 上)

    for (const other of this.objects) {
      if (other.id === objId) continue
      if (other.id === this.gripper.graspedId) continue  // 把持中は除外
      const xOverlap  = Math.abs(other.cx - obj.cx) < (other.w / 2 + obj.w / 2) * 0.7
      const otherBottom = other.cy + other.h / 2
      const isResting = xOverlap && Math.abs(otherBottom - objTop) < 12
      if (isResting) return false  // 上に何か乗っている
    }
    return true
  }

  private doGrasp() {
    if (this.gripper.isGrasping) return
    const g = this.gripper

    let nearest: { id: string; dist: number } | null = null
    for (const obj of this.objects) {
      // 上に別ブロックが乗っているものはグラスプ不可
      if (!this.isBlockAccessible(obj.id)) continue

      const dist = Math.hypot(obj.cx - g.cx, obj.cy - g.cy)
      if (dist < g.openWidth / 2 + BLOCK_W / 2 + 15) {
        if (!nearest || dist < nearest.dist) nearest = { id: obj.id, dist }
      }
    }

    if (nearest) {
      // kinematic に変更して physics に動かされないようにする
      const body = this.blockBodies.get(nearest.id)
      if (body) {
        body.setType('kinematic' as any)
        body.setLinearVelocity(vec(0, 0))
      }
      // グリッパーの cy をブロック位置に合わせてスナップ
      // → syncGraspedObject が block.cy = gripper.cy + h/2 + 4 を計算するとき
      //   ブロックが現在位置のまま維持されるようにする
      const nearestObj = this.objects.find(o => o.id === nearest!.id)
      if (nearestObj) {
        this.gripper.cy = nearestObj.cy - nearestObj.h / 2 - 4
      }
      this.gripper.isGrasping = true
      this.gripper.graspedId = nearest.id
      this.gripper.openWidth = 10
    }
  }

  private doRelease() {
    if (!this.gripper.isGrasping || !this.gripper.graspedId) return
    const graspedId = this.gripper.graspedId
    const graspedObj = this.objects.find(o => o.id === graspedId)

    // リリース前に位置を補正: 貫通していれば安全な高さに移動してから dynamic に戻す
    if (graspedObj) {
      const safeGripperY = this.getMaxGripperY(graspedObj.cx, graspedId)
      if (this.gripper.cy > safeGripperY) {
        this.gripper.cy = safeGripperY
        const safeCy = safeGripperY + graspedObj.h / 2 + 4
        graspedObj.cy = safeCy
        const body = this.blockBodies.get(graspedId)
        if (body) body.setPosition(vec(toPhysX(graspedObj.cx), toPhysY(safeCy)))
      }
    }

    const body = this.blockBodies.get(graspedId)
    if (body) {
      body.setType('dynamic' as any)
      body.setLinearVelocity(vec(0, 0))
      body.setAngularVelocity(0)
    }
    this.gripper.isGrasping = false
    this.gripper.graspedId = null
    this.gripper.openWidth = GRIPPER_OPEN_W
  }

  private syncGraspedObject() {
    if (!this.gripper.isGrasping || !this.gripper.graspedId) return
    const body = this.blockBodies.get(this.gripper.graspedId)
    if (!body) return
    // グリッパーのTCP直下にブロックを追従
    const graspedObj = this.objects.find(o => o.id === this.gripper.graspedId)
    const objH = graspedObj?.h ?? BLOCK_H
    const targetCy = this.gripper.cy + objH / 2 + 4
    body.setPosition(vec(toPhysX(this.gripper.cx), toPhysY(targetCy)))
    body.setLinearVelocity(vec(0, 0))
    // SimObject も更新
    const obj = this.objects.find(o => o.id === this.gripper.graspedId)
    if (obj) { obj.cx = this.gripper.cx; obj.cy = targetCy }
  }

  private syncFromPhysics() {
    for (const obj of this.objects) {
      if (obj.id === this.gripper.graspedId) continue
      const body = this.blockBodies.get(obj.id)
      if (!body) continue
      const pos = body.getPosition()
      obj.cx = toCanvasX(pos.x)
      obj.cy = toCanvasY(pos.y)
      if (obj.cy > CANVAS_H + 60) this.metrics.dropCount++
    }
  }

  checkSuccess(targetZoneId: string, objectId: string): boolean {
    const zone = this.zones.find(z => z.id === targetZoneId)
    const obj = this.objects.find(o => o.id === objectId)
    if (!zone || !obj) return false
    // X: ゾーン範囲内、Y: テーブル面より上（積み重ね位置も許容）
    return (
      Math.abs(obj.cx - zone.cx) < zone.w / 2 + 5 &&
      obj.cy < TABLE_TOP_CY + 5  // 落下していなければOK
    )
  }

  recordSuccess() {
    this.metrics.totalEpisodes++
    this.metrics.successCount++
    this.metrics.totalSteps += this.stepCount
    this.updateDerivedMetrics()
  }

  recordFailure() {
    this.metrics.totalEpisodes++
    this.metrics.totalSteps += this.stepCount
    this.updateDerivedMetrics()
  }

  private updateDerivedMetrics() {
    const e = this.metrics.totalEpisodes
    this.metrics.successRate = e > 0 ? this.metrics.successCount / e : 0
    this.metrics.avgSteps = e > 0 ? this.metrics.totalSteps / e : 0
  }

  getState(): WorldState {
    // NaN は JSON化すると null になりバックエンドが拒否するためサニタイズ
    const g = this.gripper
    return {
      objects: this.objects.map(o => ({
        ...o,
        cx: isFinite(o.cx) ? o.cx : 0,
        cy: isFinite(o.cy) ? o.cy : TABLE_TOP_CY - BLOCK_H / 2,
        accessible: this.isBlockAccessible(o.id),
      })),
      gripper: {
        ...g,
        cx: isFinite(g.cx) ? g.cx : CANVAS_W / 2,
        cy: isFinite(g.cy) ? g.cy : 100,
      },
      targetZones: this.zones.map(z => ({ ...z })),
    }
  }

  getDebugInfo() {
    return {
      queueLength: this.actionQueue.length,
      currentAction: this.currentAction?.type ?? null,
      gripperCx: Math.round(this.gripper.cx),
      gripperCy: Math.round(this.gripper.cy),
    }
  }
}
