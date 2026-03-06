# VLA Pick&Place Simulator

[English](#english) | [日本語](#日本語)

---


<a name="日本語"></a>

# VLA Pick&Place シミュレータ

Claude Vision で動くブラウザベースのロボット操作シミュレータです。自然言語で指示を出すと、ロボットアームがリアルタイムに物体をピック＆プレースします。

![3D Simulator](https://img.shields.io/badge/Three.js-Rapier3D-blue) ![2D Simulator](https://img.shields.io/badge/Planck.js-Canvas2D-green) ![Backend](https://img.shields.io/badge/FastAPI-Claude%20Sonnet-orange)

---

## 機能

- **3D シミュレータ** — Three.js レンダリング + Rapier 物理エンジン。PBR マテリアル、シャドウ、キネマティックグリッパー搭載。
- **2D シミュレータ** — Canvas 2D + Planck.js (Box2D)。軽量・高速。
- **Claude VLA ポリシー** — Claude Sonnet がシーン画像と状態を解釈し、ロボットアクションを出力。
- **2 つの制御モード**:
  - **オープンループ** — 全アクション列を一括生成
  - **クローズドループ** — 毎ステップ観察し、次のアクションを決定
- **自然言語指示** — 日本語・英語に対応

---

## デモ

```
指示: "赤いキューブをビンAに入れて"
```

Claude がトップダウンカメラ画像とオブジェクト状態を受け取り、ピック＆プレース手順を計画。グリッパーが物理シミュレーション付きで実行します。

---

## アーキテクチャ

```
ブラウザ (React + Vite)
  ├── 3D タブ  →  Three.js + Rapier3D  ─┐
  └── 2D タブ  →  Canvas2D + Planck.js  ┤
                                         ▼
                               FastAPI  (port 8000)
                                         │
                               Anthropic Claude API
```

本番環境では FastAPI がビルド済みフロントエンドも静的ファイルとして配信 — シングルサービス・シングルドメイン。

---

## セットアップ

### 必要なもの

- Node.js 20+
- Python 3.12+
- Anthropic API キー

### インストール & 起動

**フロントエンド**
```bash
cd frontend
npm install
npm run dev        # http://localhost:5174
```

**バックエンド**
```bash
cd backend
pip install -r requirements.txt
export ANTHROPIC_API_KEY=sk-ant-...
uvicorn main:app --reload --port 8000
```

Vite の dev サーバーが `/api` を `http://localhost:8000` にプロキシするので、http://localhost:5174 を開くだけで OK。

---

## 使い方

1. アプリを開いて **3D** または **2D** タブを選択
2. 制御モードを選択: **Open-loop** または **Closed-loop**
3. 指示を入力（ドロップダウンからサンプルを選択も可）
4. **Run** をクリック

### 指示例

| 日本語 | English |
|--------|---------|
| 赤いキューブをビンAに入れて | Pick up the red cube and place it in Bin A |
| 青い球をビンBに移動して | Put the blue sphere into Bin B |
| 緑の円柱をビンCに置いて | Move the green cylinder to Bin C |
| — | Sort all objects: cube to A, sphere to B, cylinder to C |

### 安全機能

存在しないオブジェクトへの指示（例：赤い球がいないのに「赤い球を…」）の場合、Claude は別のオブジェクトで代替せず即座に停止します。

---

## プロジェクト構成

```
vla_web/
├── frontend/               # Vite + React (2D・3D 統合)
│   └── src/
│       ├── AppRoot.tsx     # タブナビゲーション
│       ├── 2d/             # 2D シミュレータ (Planck.js)
│       └── 3d/             # 3D シミュレータ (Three.js + Rapier)
├── backend/                # FastAPI
│   ├── main.py
│   ├── claude_vla.py       # 2D ポリシー
│   ├── claude_vla3d.py     # 3D ポリシー
│   └── requirements.txt
├── Dockerfile              # マルチステージ: Node ビルド → Python ランタイム
└── render.yaml             # Render.com デプロイ設定
```

---

## デプロイ (Render.com)

### 1. GitHub に push

```bash
git add .
git commit -m "Initial commit"
git push origin main
```

### 2. Render で Web Service を作成

- Runtime: **Docker**
- Dockerfile path: `./Dockerfile`

### 3. 環境変数を設定

| キー | 値 |
|------|----|
| `ANTHROPIC_API_KEY` | Anthropic API キー |
| `APP_API_KEY` | ランダムな秘密鍵 — `openssl rand -hex 32` で生成 |
| `VITE_API_KEY` | `APP_API_KEY` と同じ値 |
| `ALLOWED_ORIGIN` | `https://your-app.onrender.com`（初回デプロイ後に設定） |

---

## 3D 座標系

```
Y (上)
│   トランジット高さ  y = 0.40 m
│
│  [Bin A]  [Bin B]  [Bin C]   z = 0.55 m
│   x=-0.35  x=0.0  x=+0.35
│
│  [物体]  [物体]  [物体]      z ≈ 0.0 m
│
└─────────────────────────────→ X (右)

テーブル面: y = 0
把持高さ:   y = 0.04 m
```

---

## ライセンス

MIT



<a name="english"></a>

A browser-based robot manipulation simulator powered by Claude Vision. Issue natural language instructions and watch the robot arm pick and place objects in real time.

![3D Simulator](https://img.shields.io/badge/Three.js-Rapier3D-blue) ![2D Simulator](https://img.shields.io/badge/Planck.js-Canvas2D-green) ![Backend](https://img.shields.io/badge/FastAPI-Claude%20Sonnet-orange)

---

## Features

- **3D Simulator** — Three.js rendering + Rapier physics. PBR materials, shadows, and kinematic gripper fingers.
- **2D Simulator** — Canvas 2D rendering + Planck.js (Box2D). Lightweight and fast.
- **Claude VLA Policy** — Claude Sonnet interprets the scene image and state, then outputs robot actions.
- **Two control modes**:
  - **Open-loop** — generates the full action sequence in one shot
  - **Closed-loop** — observes the scene at every step and decides the next action
- **Natural language instructions** — English and Japanese supported

---

## Demo

```
Instruction: "Pick up the red cube and place it in Bin A"
```

Claude receives a top-down camera image + object state, plans the pick-and-place sequence, and the gripper executes it with physics simulation.

---

## Architecture

```
Browser (React + Vite)
  ├── 3D tab  →  Three.js + Rapier3D  ─┐
  └── 2D tab  →  Canvas2D + Planck.js  ┤
                                        ▼
                              FastAPI  (port 8000)
                                        │
                              Anthropic Claude API
```

In production, FastAPI serves the built frontend as static files — a single service, single domain.

---

## Getting Started

### Prerequisites

- Node.js 20+
- Python 3.12+
- Anthropic API key

### Install & Run

**Frontend**
```bash
cd frontend
npm install
npm run dev        # http://localhost:5174
```

**Backend**
```bash
cd backend
pip install -r requirements.txt
export ANTHROPIC_API_KEY=sk-ant-...
uvicorn main:app --reload --port 8000
```

The Vite dev server proxies `/api` → `http://localhost:8000`, so just open http://localhost:5174.

---

## Usage

1. Open the app and select the **3D** or **2D** tab
2. Choose a control mode: **Open-loop** or **Closed-loop**
3. Type an instruction (or pick an example from the dropdown)
4. Click **Run**

### Example Instructions

| English | 日本語 |
|---------|-------|
| Pick up the red cube and place it in Bin A | 赤いキューブをビンAに入れて |
| Put the blue sphere into Bin B | 青い球をビンBに移動して |
| Move the green cylinder to Bin C | 緑の円柱をビンCに置いて |
| Sort all objects: cube to A, sphere to B, cylinder to C | — |

### Safety

If the instruction refers to an object that doesn't exist in the scene (e.g. "red ball" when only a Red Cube exists), Claude stops immediately instead of substituting a different object.

---

## Project Structure

```
vla_web/
├── frontend/               # Vite + React (unified 2D + 3D)
│   └── src/
│       ├── AppRoot.tsx     # Tab navigation
│       ├── 2d/             # 2D simulator (Planck.js)
│       │   ├── App2D.tsx
│       │   ├── physics/VLAWorld.ts
│       │   └── ...
│       └── 3d/             # 3D simulator (Three.js + Rapier)
│           ├── App3D.tsx
│           ├── physics3d/VLAWorld3D.ts
│           └── ...
├── backend/                # FastAPI
│   ├── main.py
│   ├── claude_vla.py       # 2D policy (open/closed loop)
│   ├── claude_vla3d.py     # 3D policy (open/closed loop)
│   ├── models.py / models3d.py
│   ├── prompts.py / prompts3d.py
│   └── requirements.txt
├── Dockerfile              # Multi-stage: Node build → Python runtime
└── render.yaml             # Render.com deployment config
```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Server + Claude availability check |
| POST | `/vla/plan` | 2D open-loop: full action sequence |
| POST | `/vla/step` | 2D closed-loop: single next action |
| POST | `/vla3d/plan` | 3D open-loop: full action sequence |
| POST | `/vla3d/step` | 3D closed-loop: single next action |

All `/vla*` endpoints require `X-API-Key` header when `APP_API_KEY` is set on the server.

---

## Deployment (Render.com)

### 1. Push to GitHub

```bash
git add .
git commit -m "Initial commit"
git push origin main
```

### 2. Create a Web Service on Render

- Runtime: **Docker**
- Dockerfile path: `./Dockerfile`

### 3. Set Environment Variables

| Key | Value |
|-----|-------|
| `ANTHROPIC_API_KEY` | Your Anthropic API key |
| `APP_API_KEY` | Random secret — `openssl rand -hex 32` |
| `VITE_API_KEY` | Same value as `APP_API_KEY` |
| `ALLOWED_ORIGIN` | `https://your-app.onrender.com` (set after first deploy) |

---

## 3D Coordinate System

```
Y (up)
│   Transit height  y = 0.40 m
│
│  [Bin A]  [Bin B]  [Bin C]   z = 0.55 m
│    x=-0.35  x=0.0  x=+0.35
│
│  [Obj]   [Obj]   [Obj]       z ≈ 0.0 m
│
└─────────────────────────────→ X (right)

Table surface: y = 0
Pick height:   y = 0.04 m
```

---

## License

MIT

---
