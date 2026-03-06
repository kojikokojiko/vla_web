"""
Unit tests for helper functions in claude_vla3d.py.
"""
from claude_vla3d import _build_state_text, _format_history
from models3d import (
    GripperState3D,
    SimObject3D,
    StepHistory3D,
    TargetBin3D,
    WorldState3D,
)


def _make_state(grasping=False, grasped_id=None):
    return WorldState3D(
        objects=[
            SimObject3D(id="red",  label="Red Cube",    color="#e74c3c", shape="cube",   accessible=True,  x=-0.25, z=0.0),
            SimObject3D(id="blue", label="Blue Sphere", color="#3498db", shape="sphere", accessible=False, x=0.0,   z=0.0),
        ],
        gripper=GripperState3D(x=0.0, y=0.4, z=0.0, openWidth=0.10, isGrasping=grasping, graspedId=grasped_id),
        targetBins=[
            TargetBin3D(id="bin_a", label="Bin A", color="red"),
            TargetBin3D(id="bin_b", label="Bin B", color="blue"),
        ],
    )


# ── _build_state_text ────────────────────────────────────────────────────────

def test_state_text_contains_object_ids():
    text = _build_state_text(_make_state())
    assert "red" in text
    assert "blue" in text


def test_state_text_contains_coordinates():
    text = _build_state_text(_make_state())
    assert "x=-0.250" in text
    assert "z=0.000" in text


def test_state_text_accessible_flag():
    text = _build_state_text(_make_state())
    assert "accessible" in text
    assert "BLOCKED" in text


def test_state_text_gripper_empty():
    text = _build_state_text(_make_state(grasping=False))
    assert "empty" in text
    assert "TCP=(0.000, 0.400, 0.000)" in text


def test_state_text_gripper_holding():
    text = _build_state_text(_make_state(grasping=True, grasped_id="red"))
    assert "holding=red" in text


def test_state_text_contains_bins():
    text = _build_state_text(_make_state())
    assert "bin_a" in text
    assert "bin_b" in text


# ── _format_history ──────────────────────────────────────────────────────────

def test_format_history_empty():
    assert _format_history([]) == ""


def test_format_history_move_tcp():
    history = [StepHistory3D(step=0, action={"type": "MOVE_TCP_TO", "x": 0.1, "y": 0.4, "z": 0.2}, reasoning="go above")]
    text = _format_history(history)
    assert "MOVE_TCP_TO" in text
    assert "0.100,0.400,0.200" in text
    assert "go above" in text


def test_format_history_set_grip():
    history = [StepHistory3D(step=1, action={"type": "SET_GRIP", "width": 0.05}, reasoning="close")]
    text = _format_history(history)
    assert "SET_GRIP" in text
    assert "width=0.050m" in text


def test_format_history_only_last_3():
    history = [
        StepHistory3D(step=i, action={"type": "WAIT"}, reasoning=f"step{i}")
        for i in range(6)
    ]
    text = _format_history(history)
    # Only last 3 steps should appear
    assert "step5" in text
    assert "step4" in text
    assert "step3" in text
    assert "step2" not in text
    assert "step0" not in text
