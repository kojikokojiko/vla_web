"""
API endpoint tests.
Claude API calls are fully mocked — no real network requests.
"""
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client():
    import main
    return TestClient(main.app)


# ── /health ──────────────────────────────────────────────────────────────────

def test_health_no_key(client, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok", "claude_available": False}


def test_health_with_key(client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json()["claude_available"] is True


# ── API key auth ──────────────────────────────────────────────────────────────

def test_auth_no_app_key_passes(client, monkeypatch):
    """APP_API_KEY not set → auth check skipped (local dev mode)."""
    monkeypatch.delenv("APP_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    res = client.post("/api/vla3d/plan", json=_minimal_plan_payload())
    assert res.status_code != 403


def test_auth_wrong_key_rejected(client, monkeypatch):
    monkeypatch.setenv("APP_API_KEY", "correct-secret")
    res = client.post(
        "/api/vla3d/plan",
        json=_minimal_plan_payload(),
        headers={"X-API-Key": "wrong-secret"},
    )
    assert res.status_code == 403


def test_auth_correct_key_passes(client, monkeypatch):
    monkeypatch.setenv("APP_API_KEY", "correct-secret")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    res = client.post(
        "/api/vla3d/plan",
        json=_minimal_plan_payload(),
        headers={"X-API-Key": "correct-secret"},
    )
    # No ANTHROPIC_API_KEY → 500, but auth itself passed (not 403)
    assert res.status_code != 403


# ── Missing ANTHROPIC_API_KEY → 500 ──────────────────────────────────────────

@pytest.mark.parametrize("path,mode", [
    ("/api/vla/plan", "2d"), ("/api/vla/step", "2d"),
    ("/api/vla3d/plan", "3d"), ("/api/vla3d/step", "3d"),
])
def test_no_anthropic_key_returns_500(client, monkeypatch, path, mode):
    monkeypatch.delenv("APP_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    payload = _minimal_plan_payload(mode) if path.endswith("plan") else _minimal_step_payload(mode)
    res = client.post(path, json=payload)
    assert res.status_code == 500
    assert "ANTHROPIC_API_KEY" in res.json()["detail"]


# ── Empty instruction → 400 ──────────────────────────────────────────────────

@pytest.mark.parametrize("path", ["/api/vla3d/plan", "/api/vla3d/step"])
def test_empty_instruction_returns_400(client, monkeypatch, path):
    monkeypatch.delenv("APP_API_KEY", raising=False)
    payload = _minimal_plan_payload() if path.endswith("plan") else _minimal_step_payload()
    payload["instruction"] = "   "
    res = client.post(path, json=payload)
    assert res.status_code == 400


# ── Happy path with mocked Claude ────────────────────────────────────────────

def test_vla3d_plan_happy_path(client, monkeypatch):
    monkeypatch.delenv("APP_API_KEY", raising=False)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")

    mock_response = MagicMock()
    mock_block = MagicMock()
    mock_block.type = "tool_use"
    mock_block.name = "submit_plan"
    mock_block.input = {
        "reasoning": "Move red cube to bin A",
        "target_object": "red",
        "target_bin": "bin_a",
        "actions": [{"type": "GRASP"}, {"type": "RELEASE"}],
    }
    mock_response.content = [mock_block]

    with patch("claude_vla3d.client.messages.create", return_value=mock_response):
        res = client.post("/api/vla3d/plan", json=_minimal_plan_payload())

    assert res.status_code == 200
    body = res.json()
    assert body["reasoning"] == "Move red cube to bin A"
    assert len(body["actions"]) == 2
    assert body["actions"][0]["type"] == "GRASP"


def test_vla3d_step_happy_path(client, monkeypatch):
    monkeypatch.delenv("APP_API_KEY", raising=False)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")

    mock_response = MagicMock()
    mock_block = MagicMock()
    mock_block.type = "tool_use"
    mock_block.name = "next_action"
    mock_block.input = {
        "reasoning": "Open gripper first",
        "action_type": "SET_GRIP",
        "width": 0.10,
    }
    mock_response.content = [mock_block]

    with patch("claude_vla3d.client.messages.create", return_value=mock_response):
        res = client.post("/api/vla3d/step", json=_minimal_step_payload())

    assert res.status_code == 200
    body = res.json()
    assert body["action"]["type"] == "SET_GRIP"
    assert body["is_done"] is False


def test_vla3d_step_done(client, monkeypatch):
    monkeypatch.delenv("APP_API_KEY", raising=False)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")

    mock_response = MagicMock()
    mock_block = MagicMock()
    mock_block.type = "tool_use"
    mock_block.name = "next_action"
    mock_block.input = {"reasoning": "Task complete", "action_type": "DONE"}
    mock_response.content = [mock_block]

    with patch("claude_vla3d.client.messages.create", return_value=mock_response):
        res = client.post("/api/vla3d/step", json=_minimal_step_payload())

    assert res.status_code == 200
    assert res.json()["is_done"] is True


# ── Helpers ───────────────────────────────────────────────────────────────────

def _minimal_plan_payload(mode="3d"):
    if mode == "2d":
        return {
            "instruction": "Put the red block in zone A",
            "image": "",
            "state": {
                "objects": [{"id": "red", "label": "Red Block", "color": "#e74c3c", "cx": 100.0, "cy": 200.0, "w": 40.0, "h": 40.0, "shape": "rect", "accessible": True}],
                "gripper": {"cx": 320.0, "cy": 50.0, "openWidth": 40.0, "isGrasping": False, "graspedId": None},
                "targetZones": [{"id": "zone_a", "label": "Zone A", "color": "red", "cx": 100.0, "cy": 500.0, "w": 80.0, "h": 80.0}],
            },
        }
    return {
        "instruction": "Put the red cube in bin A",
        "image": "",
        "image_top": "",
        "state": {
            "objects": [{"id": "red", "label": "Red Cube", "color": "#e74c3c", "shape": "cube", "accessible": True, "x": -0.25, "z": 0.0}],
            "gripper": {"x": 0.0, "y": 0.4, "z": 0.0, "openWidth": 0.10, "isGrasping": False, "graspedId": None},
            "targetBins": [{"id": "bin_a", "label": "Bin A", "color": "red"}],
        },
    }

def _minimal_step_payload(mode="3d"):
    payload = _minimal_plan_payload(mode)
    payload["history"] = []
    payload["step"] = 0
    return payload
