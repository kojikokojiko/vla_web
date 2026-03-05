"""Prompt strings and tool schemas for the Claude VLA policy."""

CANVAS_DESC = """\
## Canvas (512×512 px, Y-axis points DOWN)
- Origin: top-left
- Table surface: y = 440 px
- Block size: 44×44 px bounding box, resting center y ≈ 418
- Safe transit height: y = 100
- Gripper TCP = bottom tip of jaws; GRASP picks nearest block within ~50 px
- Block shapes: rect (square), circle, triangle — use shape info to identify objects in image
"""

STRATEGY_VLA = """\
## Standard pick-and-place sequence
1. SET_GRIP(70)              — open gripper
2. MOVE_TCP_TO(obj_x, 100)  — move above object
3. MOVE_TCP_TO(obj_x, obj_cy+5) — descend to grasp height (use actual cy from image)
4. GRASP()                  — attach block
5. MOVE_TCP_TO(obj_x, 100)  — lift
6. MOVE_TCP_TO(zone_x, 100) — move above zone
7. MOVE_TCP_TO(zone_x, 420) — lower to place height
8. RELEASE()                — drop block

No pixel coordinates are provided in the state.
Carefully examine the image to estimate the center x-pixel and y of each object and zone.

## Unstacking (MANDATORY)
If the target block is BLOCKED (accessible=false):
1. Record the blocking block's ORIGINAL position from the image.
2. Pick up the BLOCKING block and move it to a temporary free space on the table.
3. Pick up the TARGET block and place it in the destination zone.
4. ALWAYS pick up the BLOCKING block from temp and RETURN it to its ORIGINAL position.
   — Returning the blocking block is REQUIRED, not optional.
   — Even if the user's instruction doesn't mention it, you must restore it.
"""

PLAN_BASE = (
    "You are a robot manipulation policy. "
    "Given one image + instruction, output the COMPLETE action sequence to finish the task.\n"
)

STEP_BASE = (
    "You are a robot manipulation policy. "
    "At each step you see the current image and state; output ONE action.\n"
)

STEP_DONE_RULE = (
    "\nIssue ONE action per call."
    "\nAt step 0, FIRST check the image and state: if ALL required blocks are already"
    " in their target zones, call DONE immediately without taking any action."
    "\nOtherwise, call DONE only after you have successfully placed all required blocks."
)

PLAN_TOOLS = [
    {
        "name": "submit_plan",
        "description": "Submit the full ordered action sequence to complete the task.",
        "input_schema": {
            "type": "object",
            "properties": {
                "reasoning":     {"type": "string"},
                "target_object": {"type": "string", "description": "Object ID (red/blue/green)"},
                "target_zone":   {"type": "string", "description": "Zone ID (zone_a/zone_b/zone_c)"},
                "actions": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "type":  {"type": "string", "enum": ["MOVE_TCP_TO", "SET_GRIP", "GRASP", "RELEASE"]},
                            "x":     {"type": "number"},
                            "y":     {"type": "number"},
                            "width": {"type": "number"},
                        },
                        "required": ["type"],
                    },
                },
            },
            "required": ["reasoning", "actions"],
        },
    }
]

STEP_TOOLS = [
    {
        "name": "next_action",
        "description": "Output the single next action for the robot to execute.",
        "input_schema": {
            "type": "object",
            "properties": {
                "reasoning":   {"type": "string"},
                "action_type": {"type": "string", "enum": ["MOVE_TCP_TO", "SET_GRIP", "GRASP", "RELEASE", "DONE"]},
                "x":     {"type": "number"},
                "y":     {"type": "number"},
                "width": {"type": "number"},
            },
            "required": ["reasoning", "action_type"],
        },
    }
]
