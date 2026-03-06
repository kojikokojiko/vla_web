"""Claude 3D VLA Policy

run_claude_plan3d()  — Open-loop:   one shot, returns full action sequence
run_claude_step3d()  — Closed-loop: called once per step, returns next single action
"""
from anthropic import Anthropic
from models3d import Action3D, VLARequest3D, VLAResponse3D, StepRequest3D, StepResponse3D
from prompts3d import (
    CANVAS_DESC_3D, STRATEGY_VLA_3D,
    PLAN_BASE_3D, PLAN_TOOLS_3D,
    STEP_BASE_3D, STEP_TOOLS_3D, STEP_DONE_RULE_3D,
)

client = Anthropic()
MODEL = "claude-sonnet-4-6"


# ---------- helpers ----------

def _img_content(image: str) -> dict:
    data = image.split(",")[-1] if "," in image else image
    return {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": data}}


def _build_image_content(image: str, image_top: str) -> list:
    """Send only the top-down image — cleaner x,z estimation without perspective distraction."""
    src = image_top if image_top else image
    return [_img_content(src)]


def _build_system(base: str) -> str:
    return base + CANVAS_DESC_3D + STRATEGY_VLA_3D


def _build_state_text(state) -> str:
    def _acc(o) -> str:
        return "accessible" if o.accessible else "BLOCKED"

    objs = "\n".join(
        f"  {o.id}: label={o.label}, color={o.color}, shape={o.shape} x={o.x:.3f} z={o.z:.3f} [{_acc(o)}]"
        for o in state.objects
    )
    bins = "\n".join(f"  {b.id}: label={b.label}, color={b.color}" for b in state.targetBins)
    g = state.gripper
    grip = (
        f"TCP=({g.x:.3f}, {g.y:.3f}, {g.z:.3f}) "
        f"openWidth={g.openWidth:.3f}m "
        f"{'holding=' + str(g.graspedId) if g.isGrasping else 'empty'}"
    )
    return f"Objects:\n{objs}\n\nTarget Bins:\n{bins}\n\nGripper: {grip}"


def _format_history(history) -> str:
    if not history:
        return ""
    rows = []
    for h in history[-3:]:
        a = h.action
        if a.get("type") == "MOVE_TCP_TO":
            detail = f"({(a.get('x') or 0):.3f},{(a.get('y') or 0):.3f},{(a.get('z') or 0):.3f})"
        elif a.get("type") == "SET_GRIP":
            detail = f"width={a.get('width') or 0:.3f}m"
        else:
            detail = ""
        rows.append(f"  step {h.step}: {a.get('type')}{detail} — {h.reasoning}")
    return "\n\nRecent history:\n" + "\n".join(rows)


# ---------- open-loop ----------

def run_claude_plan3d(req: VLARequest3D) -> VLAResponse3D:
    text = (
        f"Instruction: \"{req.instruction}\"\n\n"
        + _build_state_text(req.state)
        + "\n\nPlan the complete 3D action sequence."
    )
    response = client.messages.create(
        model=MODEL,
        max_tokens=1024,
        system=_build_system(PLAN_BASE_3D),
        tools=PLAN_TOOLS_3D,
        tool_choice={"type": "any"},
        messages=[{"role": "user", "content": _build_image_content(req.image, req.image_top) + [{"type": "text", "text": text}]}],
    )

    for block in response.content:
        if block.type == "tool_use" and block.name == "submit_plan":
            inp = block.input
            actions = [
                Action3D(
                    type=a["type"],  # type: ignore[arg-type]
                    x=a.get("x"), y=a.get("y"), z=a.get("z"),
                    width=a.get("width"),
                )
                for a in inp.get("actions", [])
            ]
            return VLAResponse3D(
                actions=actions,
                reasoning=inp.get("reasoning", ""),
                target_object=inp.get("target_object"),
                target_bin=inp.get("target_bin"),
            )

    return VLAResponse3D(actions=[], reasoning="No tool call returned", target_object=None, target_bin=None)


# ---------- closed-loop ----------

def run_claude_step3d(req: StepRequest3D) -> StepResponse3D:
    text = (
        f"Step {req.step} | Instruction: \"{req.instruction}\"\n\n"
        + _build_state_text(req.state)
        + _format_history(req.history)
        + "\n\nChoose the next single 3D action."
    )
    response = client.messages.create(
        model=MODEL,
        max_tokens=512,
        system=_build_system(STEP_BASE_3D) + STEP_DONE_RULE_3D,
        tools=STEP_TOOLS_3D,
        tool_choice={"type": "any"},
        messages=[{"role": "user", "content": _build_image_content(req.image, req.image_top) + [{"type": "text", "text": text}]}],
    )

    for block in response.content:
        if block.type == "tool_use" and block.name == "next_action":
            inp = block.input
            atype: str = inp.get("action_type", "DONE")
            reasoning: str = inp.get("reasoning", "")
            if atype == "DONE":
                return StepResponse3D(action=Action3D(type="WAIT"), reasoning=reasoning, is_done=True)
            return StepResponse3D(
                action=Action3D(
                    type=atype,  # type: ignore[arg-type]
                    x=inp.get("x"), y=inp.get("y"), z=inp.get("z"),
                    width=inp.get("width"),
                ),
                reasoning=reasoning,
                is_done=False,
            )

    return StepResponse3D(action=Action3D(type="WAIT"), reasoning="No tool call", is_done=True)
