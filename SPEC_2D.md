
# SPEC_2D.md — VLA Pick&Place Simulator (Planck.js / Box2D)

## Goal
Browser-based 2D physics pick-and-place simulator where a robot hand follows natural language instructions using a Vision-Language-Action (VLA) policy.

## Stack
Frontend: React + TypeScript + Vite
Physics: Planck.js (Box2D)
Rendering: Canvas
Backend: FastAPI (Python)

## Core Architecture
VLA (high level decision)
→ Executor (deterministic control)
→ Planck.js physics world

## Action Space
MOVE_TCP_TO(x,y)
SET_GRIP(width)
GRASP()
RELEASE()

## Observation
Canvas PNG (512x512) + minimal state

## Metrics
- success_rate
- avg_steps
- drop_rate
- collision_count
