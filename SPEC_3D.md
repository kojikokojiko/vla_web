
# SPEC_3D.md — VLA Pick&Place Simulator (Three.js + Rapier)

## Goal
3D browser pick-and-place simulator controlled by a Vision-Language-Action (VLA) policy.

## Stack
Frontend: React + TypeScript + Vite
Rendering: Three.js
Physics: Rapier (WASM)
Backend: FastAPI

## Core Architecture
VLA policy
→ Skill executor
→ Rapier physics world

## Difficulty Control (2.5D mode)
- Movement primarily in x,y
- Z only used during pick/place
- Orientation fixed except yaw

## Action Space
MOVE_TCP_TO(x,y,z)
SET_GRIP(width)
GRASP()
RELEASE()

## Scene
- table
- bins
- objects (cube, sphere, cylinder)
