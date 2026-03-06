"""Prompt strings and tool schemas for the 3D Claude VLA policy."""

CANVAS_DESC_3D = """\
## 3D Scene — top-down camera directly above the table
- Camera at (0, 2.5, 0.28) looking straight down, FOV=40°, image 512×512 px
- Coordinate system: Y-up, +X right, +Z away from camera (into scene)
- Left/right in image = x-axis: left edge ≈ x=−0.45, right edge ≈ x=+0.45
- Top/bottom in image = z-axis: top edge ≈ z=−0.1 (front), bottom edge ≈ z=+0.65 (back/bins)
- Image center pixel ≈ (x=0, z=0.28)
- To estimate x: judge left/right relative to image center (leftward = negative x)
- To estimate z: objects on table ≈ z=0.0; bins at bottom of image = z=0.55
- Table surface: y = 0 m
- Objects rest on table (y ≈ 0.04) or inside bins (y ≈ 0.10)
- Three colored bins at BOTTOM of image: z = 0.55 m
  - bin_a (left) x=−0.35,  bin_b (center) x=0.0,  bin_c (right) x=+0.35
- Object sizes: cube 0.08 m, sphere r=0.04 m, cylinder r=0.04 m h=0.08 m
- Gripper: small rectangular shapes = fingers; midpoint = TCP
- Safe transit height: y = 0.40 m  |  Pick height: y = 0.04 m  |  Place in bin: y = 0.10 m
- All coordinates in METERS.
"""

STRATEGY_VLA_3D = """\
## Safety: Feasibility Check (ALWAYS do this first)
Before taking any action, verify the target object exists in the scene state.
- The object must match BOTH the color AND shape described in the instruction.
- If no object matches (e.g., instruction says "red ball" but only a Red Cube and Blue Sphere exist):
  - Closed-loop: call DONE immediately with reasoning explaining the mismatch.
  - Open-loop: submit an empty action list with reasoning explaining the mismatch.
- Do NOT substitute a different object. Safety over task completion.

## Standard 3D pick-and-place sequence
1. SET_GRIP(width=0.10)              — open gripper wide
2. MOVE_TCP_TO(x, 0.40, z_obj)      — transit height above object
3. MOVE_TCP_TO(x, 0.04, z_obj)      — descend to grasp height
4. GRASP()                           — attach object
5. MOVE_TCP_TO(x, 0.40, z_obj)      — lift to transit height
6. MOVE_TCP_TO(x_bin, 0.40, 0.55)   — move above target bin
7. MOVE_TCP_TO(x_bin, 0.10, 0.55)   — lower into bin
8. RELEASE()                         — drop object

Object x,z coordinates are provided in the state — use them directly.
- Object on table: use state x, z, y = 0.04
- Object in a bin: use that bin's x, z = 0.55, y = 0.10
Bins are fixed: bin_a x=−0.35, bin_b x=0.0, bin_c x=+0.35 (all at z=0.55).
Use the image only to confirm object color/shape identity.

## Key Rules
- Always transit at y=0.40 before horizontal moves to avoid collisions
- SET_GRIP width in meters: open=0.10, closed=0.02
- GRASP() attaches object when gripper is at correct XZ position and height y≈0.04
- RELEASE() drops object; gripper auto-opens to 0.10m
- If task is already done at step 0, call DONE immediately
"""

PLAN_BASE_3D = (
    "You are a 3D robot manipulation policy. "
    "Given one image + instruction, output the COMPLETE action sequence to finish the task.\n"
)

STEP_BASE_3D = (
    "You are a 3D robot manipulation policy. "
    "At each step you see the current 3D scene image and state; output ONE action.\n"
)

STEP_DONE_RULE_3D = (
    "\nIssue ONE action per call."
    "\nAt step 0, FIRST verify the instruction is feasible:"
    "\n  - If the target object does not exist in the scene (wrong color, wrong shape, etc.),"
    " call DONE immediately with reasoning explaining why (safety stop)."
    "\n  - If ALL required objects are already in their target bins, call DONE immediately."
    "\nOtherwise start the pick-and-place sequence (SET_GRIP or MOVE_TCP_TO)."
    "\nCall DONE only after all required objects are successfully placed."
    "\nDo NOT use WAIT to deliberate — use DONE to safely abort an impossible task."
)

PLAN_TOOLS_3D = [
    {
        "name": "submit_plan",
        "description": "Submit the full ordered 3D action sequence to complete the task.",
        "input_schema": {
            "type": "object",
            "properties": {
                "reasoning":      {"type": "string"},
                "target_object":  {"type": "string", "description": "Object ID"},
                "target_bin":     {"type": "string", "description": "Bin ID (bin_a/bin_b/bin_c)"},
                "actions": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "type":  {"type": "string", "enum": ["MOVE_TCP_TO", "SET_GRIP", "GRASP", "RELEASE", "WAIT"]},
                            "x":     {"type": "number", "description": "meters"},
                            "y":     {"type": "number", "description": "meters"},
                            "z":     {"type": "number", "description": "meters"},
                            "width": {"type": "number", "description": "meters (for SET_GRIP)"},
                        },
                        "required": ["type"],
                    },
                },
            },
            "required": ["reasoning", "actions"],
        },
    }
]

STEP_TOOLS_3D = [
    {
        "name": "next_action",
        "description": "Output the single next 3D action for the robot to execute.",
        "input_schema": {
            "type": "object",
            "properties": {
                "reasoning":   {"type": "string"},
                "action_type": {"type": "string", "enum": ["MOVE_TCP_TO", "SET_GRIP", "GRASP", "RELEASE", "WAIT", "DONE"]},
                "x":     {"type": "number", "description": "meters"},
                "y":     {"type": "number", "description": "meters"},
                "z":     {"type": "number", "description": "meters"},
                "width": {"type": "number", "description": "meters (for SET_GRIP)"},
            },
            "required": ["reasoning", "action_type"],
        },
    }
]
