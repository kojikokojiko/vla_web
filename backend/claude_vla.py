"""Claude Vision-Language-Action Policy

run_claude_plan()  — Open-loop:   one shot, returns the full action sequence
run_claude_step()  — Closed-loop: called once per step, returns the next single action
"""
from anthropic import Anthropic
from models import Action, VLARequest, VLAResponse, StepRequest, StepResponse
from prompts import (
    CANVAS_DESC, STRATEGY_VLA,
    PLAN_BASE, PLAN_TOOLS,
    STEP_BASE, STEP_TOOLS, STEP_DONE_RULE,
)

client = Anthropic()
MODEL = "claude-sonnet-4-6"


# ---------- helpers ----------

def _img_content(image: str) -> dict:
    data = image.split(",")[-1] if "," in image else image
    return {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": data}}


def _build_system(base: str) -> str:
    return base + CANVAS_DESC + STRATEGY_VLA


def _build_state_text(state) -> str:
    def _acc(o) -> str:
        return "accessible" if o.accessible else "BLOCKED(something on top)"

    objs  = "\n".join(f"  {o.id}: label={o.label}, color={o.color}, shape={o.shape} [{_acc(o)}]" for o in state.objects)
    zones = "\n".join(f"  {z.id}: label={z.label}" for z in state.targetZones)
    g = state.gripper
    grip  = f"TCP=({g.cx:.0f},{g.cy:.0f}) openWidth={g.openWidth:.0f} {'holding='+str(g.graspedId) if g.isGrasping else 'empty'}"
    return f"Objects:\n{objs}\n\nZones:\n{zones}\n\nGripper: {grip}"


def _format_history(history) -> str:
    if not history:
        return ""
    rows = []
    for h in history[-3:]:
        a = h.action
        if a.get("type") == "MOVE_TCP_TO":
            detail = f"({(a.get('x') or 0):.0f},{(a.get('y') or 0):.0f})"
        elif a.get("type") == "SET_GRIP":
            detail = f"width={a.get('width') or 0}"
        else:
            detail = ""
        rows.append(f"  step {h.step}: {a.get('type')}{detail} — {h.reasoning}")
    return "\n\nRecent history:\n" + "\n".join(rows)


# ---------- open-loop ----------

def run_claude_plan(req: VLARequest) -> VLAResponse:
    text = (
        f"Instruction: \"{req.instruction}\"\n\n"
        + _build_state_text(req.state)
        + "\n\nPlan the complete action sequence."
    )
    response = client.messages.create(
        model=MODEL,
        max_tokens=1024,
        system=_build_system(PLAN_BASE),
        tools=PLAN_TOOLS,
        tool_choice={"type": "any"},
        messages=[{"role": "user", "content": [_img_content(req.image), {"type": "text", "text": text}]}],
    )

    for block in response.content:
        if block.type == "tool_use" and block.name == "submit_plan":
            inp = block.input
            actions = [
                Action(type=a["type"], x=a.get("x"), y=a.get("y"), width=a.get("width"))  # type: ignore[arg-type]
                for a in inp.get("actions", [])
            ]
            return VLAResponse(
                actions=actions,
                reasoning=inp.get("reasoning", ""),
                target_object=inp.get("target_object"),
                target_zone=inp.get("target_zone"),
            )

    return VLAResponse(actions=[], reasoning="No tool call returned", target_object=None, target_zone=None)


# ---------- closed-loop ----------

def run_claude_step(req: StepRequest) -> StepResponse:
    text = (
        f"Step {req.step} | Instruction: \"{req.instruction}\"\n\n"
        + _build_state_text(req.state)
        + _format_history(req.history)
        + "\n\nChoose the next single action."
    )
    response = client.messages.create(
        model=MODEL,
        max_tokens=512,
        system=_build_system(STEP_BASE) + STEP_DONE_RULE,
        tools=STEP_TOOLS,
        tool_choice={"type": "any"},
        messages=[{"role": "user", "content": [_img_content(req.image), {"type": "text", "text": text}]}],
    )

    for block in response.content:
        if block.type == "tool_use" and block.name == "next_action":
            inp = block.input
            atype: str = inp.get("action_type", "DONE")
            reasoning: str = inp.get("reasoning", "")
            if atype == "DONE":
                return StepResponse(action=Action(type="WAIT"), reasoning=reasoning, is_done=True)
            return StepResponse(
                action=Action(type=atype, x=inp.get("x"), y=inp.get("y"), width=inp.get("width")),  # type: ignore[arg-type]
                reasoning=reasoning,
                is_done=False,
            )

    return StepResponse(action=Action(type="WAIT"), reasoning="No tool call", is_done=True)
