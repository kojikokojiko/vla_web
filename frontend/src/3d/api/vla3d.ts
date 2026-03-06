import { Action3D, WorldState3D } from '../physics3d/types3d'

// --- Open-loop ---
export interface VLARequest3D {
  instruction: string
  image: string       // perspective view (color/shape)
  image_top: string   // bird's-eye view (x,z position)
  state: WorldState3D
}
export interface VLAResponse3D {
  actions: Action3D[]
  reasoning: string
  target_object?: string
  target_bin?: string
}
const API_KEY = import.meta.env.VITE_API_KEY as string | undefined

function apiHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (API_KEY) h['X-API-Key'] = API_KEY
  return h
}

export async function callVLA3D(req: VLARequest3D): Promise<VLAResponse3D> {
  const res = await fetch('/api/vla3d/plan', {
    method: 'POST',
    headers: apiHeaders(),
    body: JSON.stringify(req),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// --- Closed-loop step ---
export interface StepHistory3D {
  step: number
  action: Partial<Action3D>
  reasoning: string
}
export interface StepRequest3D {
  instruction: string
  image: string       // perspective view (color/shape)
  image_top: string   // bird's-eye view (x,z position)
  state: WorldState3D
  history: StepHistory3D[]
  step: number
}
export interface StepResponse3D {
  action: Action3D
  reasoning: string
  is_done: boolean
}
export async function callVLAStep3D(req: StepRequest3D): Promise<StepResponse3D> {
  const res = await fetch('/api/vla3d/step', {
    method: 'POST',
    headers: apiHeaders(),
    body: JSON.stringify(req),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}
