import { Action, WorldState } from '../physics/types'

// --- Open-loop ---
export interface VLARequest {
  instruction: string
  image: string
  state: WorldState
}
export interface VLAResponse {
  actions: Action[]
  reasoning: string
  target_object?: string
  target_zone?: string
}
const API_KEY = import.meta.env.VITE_API_KEY as string | undefined

function apiHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (API_KEY) h['X-API-Key'] = API_KEY
  return h
}

export async function callVLA(req: VLARequest): Promise<VLAResponse> {
  const res = await fetch('/api/vla/plan', {
    method: 'POST',
    headers: apiHeaders(),
    body: JSON.stringify(req),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// --- Closed-loop step ---
export interface StepHistory {
  step: number
  action: Partial<Action>
  reasoning: string
}
export interface StepRequest {
  instruction: string
  image: string
  state: WorldState
  history: StepHistory[]
  step: number
}
export interface StepResponse {
  action: Action
  reasoning: string
  is_done: boolean
}
export async function callVLAStep(req: StepRequest): Promise<StepResponse> {
  const res = await fetch('/api/vla/step', {
    method: 'POST',
    headers: apiHeaders(),
    body: JSON.stringify(req),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}
