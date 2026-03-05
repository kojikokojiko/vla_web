import { Action, WorldState } from '../physics/types'

export type PolicyMode = 'vla' | 'la'

// --- Open-loop ---
export interface VLARequest {
  instruction: string
  image: string
  state: WorldState
  policy_mode: PolicyMode
}
export interface VLAResponse {
  actions: Action[]
  reasoning: string
  target_object?: string
  target_zone?: string
}
export async function callVLA(req: VLARequest): Promise<VLAResponse> {
  const res = await fetch('/api/vla/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
  policy_mode: PolicyMode
}
export interface StepResponse {
  action: Action
  reasoning: string
  is_done: boolean
}
export async function callVLAStep(req: StepRequest): Promise<StepResponse> {
  const res = await fetch('/api/vla/step', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}
