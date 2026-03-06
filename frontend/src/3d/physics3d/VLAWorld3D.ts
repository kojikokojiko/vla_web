import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type RAPIER_TYPE from '@dimforge/rapier3d-compat'
import {
  TABLE_Y, TRANSIT_Y, PICK_Y, OBJ_HALF,
  GRIPPER_OPEN_W, GRIPPER_CLOSE_W, MOVE_SPEED, BIN_Z, BIN_XS,
  Action3D, SimObject3D, TargetBin3D, GripperState3D, WorldState3D, Metrics, CaptureImages,
} from './types3d'

type RAPIER = typeof RAPIER_TYPE

// ---- Color palette ----
const PALETTE = [
  { name: 'red',    hex: '#e74c3c' },
  { name: 'blue',   hex: '#3498db' },
  { name: 'green',  hex: '#2ecc71' },
]
const BIN_COLORS = ['#e74c3c', '#3498db', '#2ecc71']

// Internal physics record per object
interface ObjPhysics {
  body: RAPIER_TYPE.RigidBody
  mesh: THREE.Mesh
  graspOffset: THREE.Vector3   // TCP-relative offset recorded at grasp moment
}

export class VLAWorld3D {
  private R: RAPIER
  private world: RAPIER_TYPE.World
  private renderer: THREE.WebGLRenderer
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera            // display camera (orbit-controlled)
  private captureCamera: THREE.PerspectiveCamera     // fixed perspective camera for VLA capture
  private captureCameraTop: THREE.PerspectiveCamera  // bird's-eye camera for precise x,z estimation
  private controls: OrbitControls
  private pipRenderer: THREE.WebGLRenderer | null = null     // PiP: perspective
  private pipTopRenderer: THREE.WebGLRenderer | null = null  // PiP: bird's-eye

  private objPhysics: Map<string, ObjPhysics> = new Map()

  // Gripper physics bodies (all kinematic)
  private fingerLeft!:  RAPIER_TYPE.RigidBody
  private fingerRight!: RAPIER_TYPE.RigidBody
  private gripperPalm!: RAPIER_TYPE.RigidBody   // base connecting both fingers
  private gripperArm!:  RAPIER_TYPE.RigidBody   // tall rod above palm (blocks objects passing over)

  // Gripper meshes
  private fingerMeshL!: THREE.Mesh
  private fingerMeshR!: THREE.Mesh
  private palmMesh!:    THREE.Mesh
  private armMesh!:     THREE.Mesh

  // Gripper geometry constants (meters)
  private readonly G = {
    FW: 0.014, FH: 0.06, FD: 0.022,   // finger: width, height, depth
    PW: 0.08,  PH: 0.012, PD: 0.025,  // palm
    AW: 0.014, AH: 0.55,  AD: 0.014,  // arm (tall: prevents objects jumping over)
  } as const

  private objects: SimObject3D[] = []
  private bins: TargetBin3D[] = []
  // Per-object internal 3D position (meters)
  private objPositions: Map<string, THREE.Vector3> = new Map()

  private gripper: GripperState3D = {
    x: 0, y: TRANSIT_Y, z: 0,
    openWidth: GRIPPER_OPEN_W,
    isGrasping: false,
    graspedId: null,
  }

  private actionQueue: Action3D[] = []
  private currentAction: Action3D | null = null
  private actionDone = true
  private gripTargetWidth = GRIPPER_OPEN_W
  private gripFrames = 0

  metrics: Metrics = {
    successRate: 0, avgSteps: 0, dropCount: 0,
    collisionCount: 0, totalEpisodes: 0, successCount: 0, totalSteps: 0,
  }
  private stepCount = 0

  // ---- Factory ----
  static async create(canvas: HTMLCanvasElement): Promise<VLAWorld3D> {
    const RAPIER = await import('@dimforge/rapier3d-compat')
    await RAPIER.init()
    return new VLAWorld3D(RAPIER, canvas)
  }

  private constructor(R: RAPIER, canvas: HTMLCanvasElement) {
    this.R = R

    // ---- Three.js ----
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight, false)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x0d1b2a)

    // Display camera — user can orbit freely
    this.camera = new THREE.PerspectiveCamera(45, canvas.clientWidth / canvas.clientHeight, 0.01, 20)
    this.camera.position.set(0, 1.6, 1.4)

    // Capture camera — fixed perspective view sent to Claude (never changes)
    this.captureCamera = new THREE.PerspectiveCamera(45, 1.0, 0.01, 20)
    this.captureCamera.position.set(0, 1.6, 1.4)
    this.captureCamera.lookAt(0, 0.0, 0.25)

    // Bird's-eye capture camera — straight down, for precise x,z position estimation
    this.captureCameraTop = new THREE.PerspectiveCamera(40, 1.0, 0.01, 20)
    this.captureCameraTop.position.set(0, 2.5, 0.28)
    this.captureCameraTop.up.set(0, 0, -1)  // +z = bins → appears at bottom of image
    this.captureCameraTop.lookAt(0, 0, 0.28)

    // OrbitControls: drag to orbit, scroll to zoom, right-drag to pan
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.target.set(0, 0.0, 0.25)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.1
    this.controls.minDistance = 0.5
    this.controls.maxDistance = 5.0
    this.controls.minPolarAngle = Math.PI / 8    // prevent looking nearly straight down
    this.controls.maxPolarAngle = Math.PI / 2.1  // prevent going below table
    this.controls.update()

    // Lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.5)
    this.scene.add(ambient)
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2)
    dirLight.position.set(1.5, 3, 2)
    dirLight.castShadow = true
    dirLight.shadow.mapSize.set(2048, 2048)
    dirLight.shadow.camera.near = 0.1
    dirLight.shadow.camera.far = 10
    dirLight.shadow.camera.left = -1.5
    dirLight.shadow.camera.right = 1.5
    dirLight.shadow.camera.top = 1.5
    dirLight.shadow.camera.bottom = -1.5
    this.scene.add(dirLight)
    const fillLight = new THREE.DirectionalLight(0x8090ff, 0.3)
    fillLight.position.set(-2, 1, -1)
    this.scene.add(fillLight)

    // Grid helper
    const grid = new THREE.GridHelper(2, 20, 0x334455, 0x223344)
    grid.position.y = 0.001
    this.scene.add(grid)

    // ---- Rapier world ----
    this.world = new R.World({ x: 0, y: -9.81, z: 0 })

    this._buildStaticScene()
    this._buildGripper()
    this.resetObjects()
  }

  // ---- Static scene (table + bins) ----
  private _buildStaticScene() {
    const R = this.R

    // Table body (visual + physics)
    const tableBody = this.world.createRigidBody(R.RigidBodyDesc.fixed())
    const tableCollider = R.ColliderDesc.cuboid(1.0, 0.025, 1.0)
      .setTranslation(0, TABLE_Y - 0.025, 0)
      .setFriction(0.9)
      .setRestitution(0.05)
    this.world.createCollider(tableCollider, tableBody)

    const tableGeo = new THREE.BoxGeometry(2.0, 0.05, 2.0)
    const tableMat = new THREE.MeshStandardMaterial({ color: 0x2c3e50, roughness: 0.8, metalness: 0.1 })
    const tableMesh = new THREE.Mesh(tableGeo, tableMat)
    tableMesh.position.set(0, TABLE_Y - 0.025, 0)
    tableMesh.receiveShadow = true
    this.scene.add(tableMesh)

    // Bins
    const binLabels = ['Bin A', 'Bin B', 'Bin C']
    BIN_XS.forEach((bx, i) => {
      this.bins.push({ id: `bin_${String.fromCharCode(97 + i)}`, label: binLabels[i], color: BIN_COLORS[i] })
      this._buildBin(bx, 0, BIN_Z, BIN_COLORS[i], `bin_${String.fromCharCode(97 + i)}`)
    })
  }

  private _buildBin(cx: number, _cy: number, cz: number, color: string, _id: string) {
    const R = this.R
    const w = 0.18, h = 0.10, d = 0.18, t = 0.008
    const threeColor = new THREE.Color(color)
    const mat = new THREE.MeshStandardMaterial({
      color: threeColor, transparent: true, opacity: 0.55,
      roughness: 0.6, metalness: 0.0, side: THREE.DoubleSide,
    })

    const specs = [
      // bottom
      { gw: w, gh: t, gd: d, px: 0, py: t / 2, pz: 0 },
      // front wall
      { gw: w, gh: h, gd: t, px: 0, py: h / 2, pz: -d / 2 },
      // back wall
      { gw: w, gh: h, gd: t, px: 0, py: h / 2, pz: d / 2 },
      // left wall
      { gw: t, gh: h, gd: d, px: -w / 2, py: h / 2, pz: 0 },
      // right wall
      { gw: t, gh: h, gd: d, px: w / 2, py: h / 2, pz: 0 },
    ]

    for (const sp of specs) {
      // Visual
      const geo = new THREE.BoxGeometry(sp.gw, sp.gh, sp.gd)
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.set(cx + sp.px, sp.py, cz + sp.pz)
      mesh.receiveShadow = true
      this.scene.add(mesh)

      // Physics
      const body = this.world.createRigidBody(R.RigidBodyDesc.fixed())
      const cDesc = R.ColliderDesc.cuboid(sp.gw / 2, sp.gh / 2, sp.gd / 2)
        .setTranslation(cx + sp.px, sp.py, cz + sp.pz)
        .setFriction(0.7)
        .setRestitution(0.05)
      this.world.createCollider(cDesc, body)
    }
  }

  // ---- Gripper ----
  private _buildGripper() {
    const R = this.R
    const { FW, FH, FD, PW, PH, PD, AW, AH, AD } = this.G

    const matFinger = new THREE.MeshStandardMaterial({ color: 0xbdc3c7, roughness: 0.4, metalness: 0.6 })
    const matArm    = new THREE.MeshStandardMaterial({ color: 0x78909c, roughness: 0.5, metalness: 0.5 })

    // Helper: create velocity-based kinematic Rapier body + box collider.
    // VelocityBased = Rapier moves body by setLinvel*dt each step,
    // so collision forces are derived from actual velocity (not teleportation).
    const makeKinematic = (hw: number, hh: number, hd: number) => {
      const body = this.world.createRigidBody(R.RigidBodyDesc.kinematicVelocityBased())
      this.world.createCollider(
        R.ColliderDesc.cuboid(hw, hh, hd).setFriction(0.9).setRestitution(0.0),
        body,
      )
      return body
    }

    // Helper: create Three.js mesh and add to scene
    const makeMesh = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
      const m = new THREE.Mesh(geo, mat)
      m.castShadow = true
      this.scene.add(m)
      return m
    }

    // Fingers (kinematic, physically squeeze objects when closing)
    this.fingerLeft  = makeKinematic(FW / 2, FH / 2, FD / 2)
    this.fingerRight = makeKinematic(FW / 2, FH / 2, FD / 2)
    this.fingerMeshL = makeMesh(new THREE.BoxGeometry(FW, FH, FD), matFinger.clone())
    this.fingerMeshR = makeMesh(new THREE.BoxGeometry(FW, FH, FD), matFinger.clone())

    // Palm: connects both fingers at the top (prevents objects from sliding up between fingers)
    this.gripperPalm = makeKinematic(PW / 2, PH / 2, PD / 2)
    this.palmMesh    = makeMesh(new THREE.BoxGeometry(PW, PH, PD), matArm.clone())

    // Arm: tall rod above palm — blocks objects from passing through/over the arm
    this.gripperArm = makeKinematic(AW / 2, AH / 2, AD / 2)
    this.armMesh    = makeMesh(new THREE.CylinderGeometry(AW / 2, AW / 2, AH, 8), matArm.clone())

    this._updateFingerPositions()
  }

  // dt=0 → teleport (used at init/reset); dt>0 → velocity-based (used every physics frame)
  private _updateFingerPositions(dt = 0) {
    const g = this.gripper
    const { FH, PH, AH } = this.G
    const half = g.openWidth / 2

    // All gripper parts extend UPWARD from TCP = (g.x, g.y, g.z)
    const targets: [RAPIER_TYPE.RigidBody, THREE.Mesh, number, number, number][] = [
      [this.fingerLeft,  this.fingerMeshL, g.x - half, g.y + FH / 2,          g.z],
      [this.fingerRight, this.fingerMeshR, g.x + half, g.y + FH / 2,          g.z],
      [this.gripperPalm, this.palmMesh,    g.x,        g.y + FH + PH / 2,     g.z],
      [this.gripperArm,  this.armMesh,     g.x,        g.y + FH + PH + AH / 2, g.z],
    ]

    for (const [body, mesh, tx, ty, tz] of targets) {
      if (dt > 0) {
        // Velocity = displacement / dt → Rapier computes physically correct contact forces
        const cur = body.translation()
        body.setLinvel({ x: (tx - cur.x) / dt, y: (ty - cur.y) / dt, z: (tz - cur.z) / dt }, true)
      } else {
        // dt=0: teleport directly (init / reset)
        body.setTranslation({ x: tx, y: ty, z: tz }, true)
      }
      mesh.position.set(tx, ty, tz)
    }

    const color = g.isGrasping ? 0xe67e22 : 0xbdc3c7
    ;(this.fingerMeshL.material as THREE.MeshStandardMaterial).color.setHex(color)
    ;(this.fingerMeshR.material as THREE.MeshStandardMaterial).color.setHex(color)
  }

  // ---- Objects ----
  resetObjects() {
    this.gripper.isGrasping = false
    this.gripper.graspedId = null

    // Destroy old physics bodies
    for (const op of this.objPhysics.values()) {
      this.world.removeRigidBody(op.body)
      this.scene.remove(op.mesh)
    }
    this.objPhysics.clear()
    this.objPositions.clear()

    const initialObjs: { id: string; label: string; color: string; shape: 'cube' | 'sphere' | 'cylinder'; x: number; z: number }[] = [
      { id: 'red',   label: 'Red Cube',      color: '#e74c3c', shape: 'cube',     x: -0.25, z: 0.0 },
      { id: 'blue',  label: 'Blue Sphere',   color: '#3498db', shape: 'sphere',   x:  0.0,  z: 0.0 },
      { id: 'green', label: 'Green Cylinder', color: '#2ecc71', shape: 'cylinder', x:  0.25, z: 0.0 },
    ]

    this.objects = initialObjs.map(o => {
      this._spawnObject(o.id, o.label, o.color, o.shape, o.x, PICK_Y + 0.01, o.z)
      return { id: o.id, label: o.label, color: o.color, shape: o.shape, accessible: true, x: o.x, z: o.z }
    })

    this.gripper = { x: 0, y: TRANSIT_Y, z: 0, openWidth: GRIPPER_OPEN_W, isGrasping: false, graspedId: null }
    this.gripTargetWidth = GRIPPER_OPEN_W
    this.actionQueue = []
    this.currentAction = null
    this.actionDone = true
    this.stepCount = 0
    this._updateFingerPositions()
  }

  private _spawnObject(
    id: string, label: string, color: string,
    shape: 'cube' | 'sphere' | 'cylinder',
    x: number, y: number, z: number,
  ) {
    const R = this.R
    const threeColor = new THREE.Color(color)
    const mat = new THREE.MeshStandardMaterial({ color: threeColor, roughness: 0.55, metalness: 0.1 })

    let geo: THREE.BufferGeometry
    let cDesc: RAPIER_TYPE.ColliderDesc

    if (shape === 'sphere') {
      geo = new THREE.SphereGeometry(OBJ_HALF, 16, 12)
      cDesc = R.ColliderDesc.ball(OBJ_HALF)
    } else if (shape === 'cylinder') {
      geo = new THREE.CylinderGeometry(OBJ_HALF, OBJ_HALF, OBJ_HALF * 2, 16)
      cDesc = R.ColliderDesc.cylinder(OBJ_HALF, OBJ_HALF)
    } else {
      geo = new THREE.BoxGeometry(OBJ_HALF * 2, OBJ_HALF * 2, OBJ_HALF * 2)
      cDesc = R.ColliderDesc.cuboid(OBJ_HALF, OBJ_HALF, OBJ_HALF)
    }

    const mesh = new THREE.Mesh(geo, mat)
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.position.set(x, y, z)

    // Label sprite
    const canvas = document.createElement('canvas')
    canvas.width = 128; canvas.height = 32
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = color
    ctx.font = 'bold 20px monospace'
    ctx.textAlign = 'center'
    ctx.fillText(label.split(' ')[0], 64, 22)
    const tex = new THREE.CanvasTexture(canvas)
    const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true })
    const sprite = new THREE.Sprite(spriteMat)
    sprite.scale.set(0.12, 0.03, 1)
    sprite.position.set(0, OBJ_HALF + 0.025, 0)
    mesh.add(sprite)

    this.scene.add(mesh)

    const bd = R.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z)
      .setLinearDamping(0.6)
      .setAngularDamping(0.9)

    // Per-shape rotation policy:
    //   cube     → fully locked (stays upright, predictable)
    //   cylinder → only Y-axis allowed (can spin/yaw, won't tip sideways)
    //   sphere   → all axes free (rolls naturally)
    if (shape === 'cube') {
      bd.lockRotations()
    } else if (shape === 'cylinder') {
      bd.enabledRotations(false, true, false)
    }
    const body = this.world.createRigidBody(bd)

    cDesc
      .setDensity(600)
      .setFriction(0.8)
      .setRestitution(0.15)
    this.world.createCollider(cDesc, body)

    this.objPhysics.set(id, { body, mesh, graspOffset: new THREE.Vector3() })
    this.objPositions.set(id, new THREE.Vector3(x, y, z))
  }

  randomizeScene() {
    this.gripper.isGrasping = false
    this.gripper.graspedId = null
    for (const op of this.objPhysics.values()) {
      this.world.removeRigidBody(op.body)
      this.scene.remove(op.mesh)
    }
    this.objPhysics.clear()
    this.objPositions.clear()

    const shapes: Array<'cube' | 'sphere' | 'cylinder'> = ['cube', 'sphere', 'cylinder']
    const shuffled = [...PALETTE].sort(() => Math.random() - 0.5)

    this.objects = shuffled.map((c, i) => {
      const shape = shapes[i % 3]
      const x = -0.25 + i * 0.25 + (Math.random() - 0.5) * 0.08
      const z = (Math.random() - 0.5) * 0.06
      this._spawnObject(c.name, `${c.name.charAt(0).toUpperCase() + c.name.slice(1)} ${shape}`, c.hex, shape, x, PICK_Y + 0.01, z)
      return { id: c.name, label: `${c.name.charAt(0).toUpperCase() + c.name.slice(1)} ${shape}`, color: c.hex, shape, accessible: true, x, z }
    })

    this.gripper = { x: 0, y: TRANSIT_Y, z: 0, openWidth: GRIPPER_OPEN_W, isGrasping: false, graspedId: null }
    this.gripTargetWidth = GRIPPER_OPEN_W
    this.actionQueue = []
    this.currentAction = null
    this.actionDone = true
    this.stepCount = 0
    this._updateFingerPositions()
  }

  // ---- Action queue ----
  enqueueActions(actions: Action3D[]) {
    this.actionQueue.push(...actions)
  }

  get isIdle() {
    return this.currentAction === null && this.actionQueue.length === 0
  }

  // ---- Main step ----
  step(dtMs: number) {
    // Cap dt to avoid huge velocities on tab-resume or first frame
    const dt = Math.min(dtMs / 1000, 1 / 20)
    try {
      this._processAction()
      this._tryAutoGrasp()          // contact-based auto hold: triggers when fingers touch object
      this._syncGraspedObject()     // move kinematic grasped object with TCP
      this._updateFingerPositions(dt)
      this.world.step()
      this._syncMeshesFromPhysics()
      this._detectDrops()
      this.controls.update()
      this.renderer.render(this.scene, this.camera)
      // PiP: render capture views into preview canvases if set
      if (this.pipRenderer) {
        this.pipRenderer.render(this.scene, this.captureCamera)
      }
      if (this.pipTopRenderer) {
        this.pipTopRenderer.render(this.scene, this.captureCameraTop)
      }
    } catch (e) {
      console.error('[VLAWorld3D.step]', e)
    }
  }

  // ---- Action processing ----
  private _processAction() {
    if (this.currentAction === null || this.actionDone) {
      if (this.actionQueue.length === 0) { this.currentAction = null; return }
      this.currentAction = this.actionQueue.shift()!
      this.actionDone = false
    }

    const act = this.currentAction
    switch (act.type) {
      case 'MOVE_TCP_TO': {
        const tx = act.x ?? this.gripper.x
        const ty = Math.max(0.01, act.y ?? this.gripper.y)
        const tz = act.z ?? this.gripper.z
        this.actionDone = this._moveTo(tx, ty, tz)
        break
      }
      case 'SET_GRIP': {
        const target = Math.max(GRIPPER_CLOSE_W, Math.min(GRIPPER_OPEN_W, act.width ?? GRIPPER_OPEN_W))
        this.gripTargetWidth = target
        // Closing: slow (30 frames ≈ 2.7mm/frame) so fingers push objects gently without clipping.
        // Opening: fast (5 frames) — no clipping risk when widening.
        this.gripFrames = target < this.gripper.openWidth ? 30 : 5
        this.actionDone = true
        break
      }
      case 'GRASP':
        this._doGrasp()
        this.actionDone = true
        break
      case 'RELEASE':
        this._doRelease()
        this.actionDone = true
        break
      case 'WAIT':
        this.actionDone = true
        break
    }

    // Smooth grip width
    if (this.gripFrames > 0) {
      const step = (this.gripTargetWidth - this.gripper.openWidth) / this.gripFrames
      this.gripper.openWidth += step
      this.gripFrames--
    }

    if (this.actionDone) {
      this.stepCount++
      this.currentAction = null
    }
  }

  // Minimum TCP Y so the held object doesn't penetrate other objects or the table.
  // Mirrors 2D VLAWorld.getMaxGripperY() — geometric collision prevention, no physics needed.
  private _getMinGripperY(tcpX: number, tcpZ: number, graspedId: string): number {
    const op = this.objPhysics.get(graspedId)
    if (!op) return PICK_Y
    const off = op.graspOffset

    // Floor limit: held object bottom (tcp_y + off.y - OBJ_HALF) must stay above table (y=0)
    let minY = OBJ_HALF - off.y

    // Stacking limit: check XZ overlap with every other object
    for (const [id, pos] of this.objPositions) {
      if (id === graspedId) continue
      const dxz = Math.sqrt((pos.x - tcpX) ** 2 + (pos.z - tcpZ) ** 2)
      if (dxz >= OBJ_HALF * 2) continue  // no XZ overlap → no height constraint
      // Held object bottom must clear other object top + 2mm margin
      // tcp_y + off.y - OBJ_HALF >= pos.y + OBJ_HALF + 0.002
      const limitY = pos.y + OBJ_HALF * 2 + 0.002 - off.y
      if (limitY > minY) minY = limitY
    }
    return minY
  }

  private _moveTo(tx: number, ty: number, tz: number): boolean {
    const g = this.gripper

    // Height clamping when holding an object (mirrors 2D logic):
    // check both target XZ and current XZ, use the more restrictive limit.
    if (g.isGrasping && g.graspedId) {
      const minAtTarget  = this._getMinGripperY(tx, tz, g.graspedId)
      const minAtCurrent = this._getMinGripperY(g.x, g.z, g.graspedId)
      const minY = Math.max(minAtTarget, minAtCurrent)
      ty = Math.max(ty, minY)
      if (g.y < minY) g.y = minY  // instant correction if already below limit
    }

    const dx = tx - g.x, dy = ty - g.y, dz = tz - g.z
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
    if (dist < 0.003) {
      g.x = tx; g.y = ty; g.z = tz
      return true
    }
    const spd = Math.min(MOVE_SPEED, dist)
    g.x += (dx / dist) * spd
    g.y += (dy / dist) * spd
    g.z += (dz / dist) * spd
    return false
  }

  // Core grasp attachment: switch object to position-based kinematic and record TCP-relative offset.
  // Called both from explicit GRASP() action and from _tryAutoGrasp() (contact detection).
  private _attachGrasp(id: string) {
    const op = this.objPhysics.get(id)
    if (!op) return
    const g = this.gripper
    const pos = this.objPositions.get(id)!

    op.body.setBodyType(this.R.RigidBodyType.KinematicPositionBased, true)
    op.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    op.body.setAngvel({ x: 0, y: 0, z: 0 }, true)

    // Snap TCP X/Z to object center so fingers are always symmetric around the object.
    // This eliminates visual clipping even when TCP was slightly off-center at grasp time.
    g.x = pos.x
    g.z = pos.z
    // Only Y offset remains (object sits above TCP jaw-tip level)
    op.graspOffset.set(0, pos.y - g.y, 0)

    g.isGrasping = true
    g.graspedId = id

    // Set grip width so finger inner face is exactly at object surface — zero clipping.
    // contactWidth = 2 * (OBJ_HALF + FW/2): finger center at OBJ_HALF + FW/2 from TCP center,
    // inner face at OBJ_HALF — exactly touching the object surface.
    const contactWidth = 2 * (OBJ_HALF + this.G.FW / 2)  // = 0.094 m
    this.gripper.openWidth = contactWidth
    this.gripTargetWidth = contactWidth
    this.gripFrames = 0
  }

  // Auto-grasp: triggered when finger inner face physically reaches the object surface.
  // Called every frame; only active while grip is actively closing.
  private _tryAutoGrasp() {
    if (this.gripper.isGrasping) return
    // Only check while actively closing — prevents accidental grasps when passing near objects
    if (this.gripTargetWidth >= this.gripper.openWidth - 0.001) return

    const g = this.gripper
    // Finger inner face distance from TCP center = openWidth/2 - FW/2
    const fingerInner = g.openWidth / 2 - this.G.FW / 2

    let nearest: { id: string; dxz: number } | null = null
    for (const [id, pos] of this.objPositions) {
      const dxz = Math.sqrt((pos.x - g.x) ** 2 + (pos.z - g.z) ** 2)
      const dy  = Math.abs(pos.y - g.y)
      if (dy > 0.08) continue
      // Contact: finger inner face has reached the near surface of the object.
      // objSurface = dxz + OBJ_HALF (outer edge of object from TCP, worst-case direction).
      // Trigger 1mm early to avoid visual clipping (slow grip = only ~1 frame error).
      const objSurface = dxz + OBJ_HALF - 0.001
      if (fingerInner <= objSurface && dxz < g.openWidth / 2 + OBJ_HALF) {
        if (!nearest || dxz < nearest.dxz) nearest = { id, dxz }
      }
    }
    if (nearest) this._attachGrasp(nearest.id)
  }

  // Explicit GRASP() action — uses a wider tolerance for forgiving Claude-generated plans
  private _doGrasp() {
    if (this.gripper.isGrasping) return
    const g = this.gripper
    let nearest: { id: string; dist: number } | null = null
    for (const [id, pos] of this.objPositions) {
      const dxz = Math.sqrt((pos.x - g.x) ** 2 + (pos.z - g.z) ** 2)
      const dy  = Math.abs(pos.y - g.y)
      if (dxz < g.openWidth / 2 + OBJ_HALF + 0.04 && dy < 0.09) {
        const dist = Math.sqrt(dxz * dxz + dy * dy)
        if (!nearest || dist < nearest.dist) nearest = { id, dist }
      }
    }
    if (nearest) {
      this._attachGrasp(nearest.id)
      // For explicit GRASP, close fingers to holding width
      this.gripper.openWidth = GRIPPER_CLOSE_W
      this.gripTargetWidth = GRIPPER_CLOSE_W
    }
  }

  private _doRelease() {
    if (!this.gripper.isGrasping || !this.gripper.graspedId) return
    const graspedId = this.gripper.graspedId
    const op = this.objPhysics.get(graspedId)
    if (op) {
      // Safety: if object is below the geometric limit, push it up before switching to dynamic
      // (mirrors 2D doRelease position correction)
      const g = this.gripper
      const minY = this._getMinGripperY(g.x, g.z, graspedId)
      if (g.y < minY) {
        g.y = minY
        const off = op.graspOffset
        const safeX = g.x + off.x
        const safeY = Math.max(OBJ_HALF, g.y + off.y)
        const safeZ = g.z + off.z
        op.body.setTranslation({ x: safeX, y: safeY, z: safeZ }, true)
        op.mesh.position.set(safeX, safeY, safeZ)
        this.objPositions.set(graspedId, new THREE.Vector3(safeX, safeY, safeZ))
      }
      op.body.setBodyType(this.R.RigidBodyType.Dynamic, true)
      // Reset velocity so physics explosion from kinematic→dynamic switch doesn't launch object
      op.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
      op.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    }
    this.gripper.isGrasping = false
    this.gripper.graspedId = null
    this.gripper.openWidth = GRIPPER_OPEN_W
    this.gripTargetWidth = GRIPPER_OPEN_W
  }

  // Move the grasped (kinematic position-based) object to exactly follow TCP + recorded offset.
  // KinematicPositionBased: Rapier computes implicit velocity = (nextPos − curPos) / dt,
  // so other dynamic bodies still get physically correct contact forces from the moving object.
  private _syncGraspedObject() {
    if (!this.gripper.isGrasping || !this.gripper.graspedId) return
    const op = this.objPhysics.get(this.gripper.graspedId)
    if (!op) return
    const g = this.gripper
    const off = op.graspOffset
    const tx = g.x + off.x
    const ty = Math.max(OBJ_HALF, g.y + off.y)
    const tz = g.z + off.z
    op.body.setNextKinematicTranslation({ x: tx, y: ty, z: tz })
    this.objPositions.set(this.gripper.graspedId, new THREE.Vector3(tx, ty, tz))
    op.mesh.position.set(tx, ty, tz)
  }

  private _syncMeshesFromPhysics() {
    const MAX_SPEED = 8.0  // m/s — clamp to prevent physics explosion from launching objects
    for (const [id, op] of this.objPhysics) {
      if (id === this.gripper.graspedId) continue   // kinematic object already synced above
      const t = op.body.translation()

      // NaN guard: physics explosion can produce NaN coords → Three.js silently hides the mesh
      if (!isFinite(t.x) || !isFinite(t.y) || !isFinite(t.z)) {
        const last = this.objPositions.get(id)
        if (last) op.body.setTranslation({ x: last.x, y: last.y + 0.01, z: last.z }, true)
        op.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
        op.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
        continue
      }

      // Velocity clamp: spheres have no rotation lock so they can pick up excessive speed
      const v = op.body.linvel()
      const speed = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
      if (speed > MAX_SPEED) {
        const s = MAX_SPEED / speed
        op.body.setLinvel({ x: v.x * s, y: v.y * s, z: v.z * s }, true)
      }

      const r = op.body.rotation()
      op.mesh.position.set(t.x, t.y, t.z)
      op.mesh.quaternion.set(r.x, r.y, r.z, r.w)
      this.objPositions.set(id, new THREE.Vector3(t.x, t.y, t.z))
    }
  }

  private _detectDrops() {
    for (const [, pos] of this.objPositions) {
      if (pos.y < -0.5) this.metrics.dropCount++
    }
  }

  // ---- Success check ----
  checkSuccess(binId: string, objId: string): boolean {
    const binIndex = this.bins.findIndex(b => b.id === binId)
    if (binIndex < 0) return false
    const bx = BIN_XS[binIndex]
    const pos = this.objPositions.get(objId)
    if (!pos) return false
    const inX = Math.abs(pos.x - bx) < 0.12
    const inZ = Math.abs(pos.z - BIN_Z) < 0.12
    const onTable = pos.y > -0.2
    return inX && inZ && onTable
  }

  // ---- Metrics ----
  recordSuccess() {
    this.metrics.totalEpisodes++
    this.metrics.successCount++
    this.metrics.totalSteps += this.stepCount
    this._updateDerived()
  }

  recordFailure() {
    this.metrics.totalEpisodes++
    this.metrics.totalSteps += this.stepCount
    this._updateDerived()
  }

  private _updateDerived() {
    const e = this.metrics.totalEpisodes
    this.metrics.successRate = e > 0 ? this.metrics.successCount / e : 0
    this.metrics.avgSteps = e > 0 ? this.metrics.totalSteps / e : 0
  }

  // ---- State ----
  getState(): WorldState3D {
    const g = this.gripper
    return {
      objects: this.objects.map(o => {
        const pos = this.objPositions.get(o.id)
        return { ...o, accessible: true, x: pos ? pos.x : 0, z: pos ? pos.z : 0 }
      }),
      gripper: {
        x: isFinite(g.x) ? g.x : 0,
        y: isFinite(g.y) ? g.y : TRANSIT_Y,
        z: isFinite(g.z) ? g.z : 0,
        openWidth: g.openWidth,
        isGrasping: g.isGrasping,
        graspedId: g.graspedId,
      },
      targetBins: this.bins.map(b => ({ ...b })),
    }
  }

  getDebugInfo() {
    return {
      queueLength: this.actionQueue.length,
      currentAction: this.currentAction?.type ?? null,
      tcpX: this.gripper.x.toFixed(3),
      tcpY: this.gripper.y.toFixed(3),
      tcpZ: this.gripper.z.toFixed(3),
    }
  }

  // ---- PiP preview canvases ----
  setCapturePreviewCanvas(canvas: HTMLCanvasElement | null) {
    if (this.pipRenderer) { this.pipRenderer.dispose(); this.pipRenderer = null }
    if (canvas) {
      this.pipRenderer = new THREE.WebGLRenderer({ canvas, antialias: true })
      this.pipRenderer.setSize(canvas.width, canvas.height, false)
      this.pipRenderer.shadowMap.enabled = false
    }
  }

  setCaptureTopPreviewCanvas(canvas: HTMLCanvasElement | null) {
    if (this.pipTopRenderer) { this.pipTopRenderer.dispose(); this.pipTopRenderer = null }
    if (canvas) {
      this.pipTopRenderer = new THREE.WebGLRenderer({ canvas, antialias: true })
      this.pipTopRenderer.setSize(canvas.width, canvas.height, false)
      this.pipTopRenderer.shadowMap.enabled = false
    }
  }

  // ---- Canvas capture — returns both perspective + bird's-eye images for Claude ----
  capture(): CaptureImages {
    const size = 512
    const offscreen = document.createElement('canvas')
    offscreen.width = size
    offscreen.height = size
    const offRenderer = new THREE.WebGLRenderer({ canvas: offscreen, antialias: true })
    offRenderer.setSize(size, size)
    offRenderer.shadowMap.enabled = false

    // Perspective view (color/shape identification)
    offRenderer.render(this.scene, this.captureCamera)
    const perspective = offRenderer.domElement.toDataURL('image/png')

    // Bird's-eye view (precise x,z position estimation)
    offRenderer.render(this.scene, this.captureCameraTop)
    const topdown = offRenderer.domElement.toDataURL('image/png')

    offRenderer.dispose()
    return { perspective, topdown }
  }

  // ---- Camera presets ----
  setCameraPreset(preset: 'default' | 'top' | 'front' | 'side' | 'iso') {
    const presets: Record<string, { pos: [number, number, number]; target: [number, number, number] }> = {
      default: { pos: [0,   1.6, 1.4],  target: [0, 0.0, 0.25] },
      top:     { pos: [0,   2.8, 0.3],  target: [0, 0.0, 0.28] },
      front:   { pos: [0,   0.6, 2.2],  target: [0, 0.1, 0.0]  },
      side:    { pos: [2.0, 0.9, 0.6],  target: [0, 0.1, 0.3]  },
      iso:     { pos: [1.2, 1.6, 1.2],  target: [0, 0.0, 0.25] },
    }
    const p = presets[preset]
    this.camera.position.set(...p.pos)
    this.controls.target.set(...p.target)
    this.controls.update()
  }

  // ---- Resize ----
  resize(w: number, h: number) {
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.controls.update()
  }
}
