# VLA 実装解説 — 2D Pick & Place シミュレータ

## 概要

このプロジェクトの VLA (Vision-Language-Action) は、**カスタムの機械学習モデルを持たず**、Anthropic の Claude (claude-sonnet-4-6) をポリシーモデルとして活用した設計です。Claude がスクリーンショット（Vision）と自然言語指示（Language）を受け取り、構造化されたアクション列（Action）を返します。

```
Vision  (512×512 canvas PNG)
   +
Language (自然言語指示: "Pick up the red block and place it in Zone A")
   +
State   (オブジェクト座標・グリッパー状態のJSON)
   │
   ▼
Claude claude-sonnet-4-6  ←── VLA ポリシーの本体
   │
   ▼
Action  [{type:"MOVE_TCP_TO", x:120, y:100}, {type:"GRASP"}, ...]
   │
   ▼
2D Physics (Planck.js / Box2D)
```

---

## アーキテクチャ全体図

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend (React + Vite)              │
│                                                             │
│  App.tsx ─── ボタン押下                                      │
│    │                                                        │
│    ├── captureRef.current()   → canvas PNG (base64)         │
│    ├── worldRef.getState()    → WorldState JSON             │
│    │                                                        │
│    ├──[open-loop]── callVLA()    POST /api/vla/plan         │
│    └──[closed-loop]─ callVLAStep() POST /api/vla/step       │
│                                                             │
│  SimCanvas.tsx ── rAF ループ (60fps)                         │
│    └── VLAWorld.step(dt)                                    │
│          ├── processAction()  ← Action キューを消化           │
│          ├── world.step(dt)   ← Box2D 物理演算               │
│          └── syncFromPhysics() ← ブロック位置を読み戻す       │
└────────────────────┬────────────────────────────────────────┘
                     │ HTTP (Vite proxy: /api/* → :8000)
┌────────────────────▼────────────────────────────────────────┐
│                        Backend (FastAPI)                    │
│                                                             │
│  main.py                                                    │
│    ├── POST /vla/plan  → run_claude_plan(req)               │
│    └── POST /vla/step  → run_claude_step(req)               │
│                                                             │
│  claude_vla.py                                              │
│    ├── run_claude_plan()  → VLAResponse (actions[])         │
│    └── run_claude_step() → StepResponse (action, is_done)   │
│                                                             │
│  prompts.py                                                 │
│    ├── CANVAS_DESC    (座標系の説明)                         │
│    ├── STRATEGY_VLA   (pick-place 手順、画像推論の指示)       │
│    ├── PLAN_TOOLS     (submit_plan ツール定義)               │
│    └── STEP_TOOLS     (next_action ツール定義)              │
└────────────────────┬────────────────────────────────────────┘
                     │ Anthropic Python SDK
┌────────────────────▼────────────────────────────────────────┐
│                  Claude claude-sonnet-4-6 API                    │
│                  (Tool Use / Structured Output)             │
└─────────────────────────────────────────────────────────────┘
```

---

## コアファイル一覧

| ファイル | 役割 |
|---|---|
| `backend/claude_vla.py` | VLA ポリシー本体。Anthropic API 呼び出し、状態テキスト生成 |
| `backend/prompts.py` | プロンプト文字列・ツール定義 (`CANVAS_DESC`, `STRATEGY_VLA`, `PLAN_TOOLS`, `STEP_TOOLS`) |
| `backend/models.py` | Pydantic データモデル (Action, WorldState, Request/Response) |
| `backend/main.py` | FastAPI エンドポイント |
| `frontend/src/physics/VLAWorld.ts` | Planck.js 物理ワールド、グリッパー制御、アクション実行 |
| `frontend/src/hooks/useVLARunner.ts` | open/closed ループ制御、メトリクス・ログ管理 (カスタムフック) |
| `frontend/src/App.tsx` | トップレベルレイアウト (薄いラッパー) |
| `frontend/src/components/SimCanvas.tsx` | Canvas 描画 + rAF ゲームループ |
| `frontend/src/components/ControlPanel.tsx` | ループモード切替・命令入力UI |
| `frontend/src/constants/examples.ts` | 例文一覧 |
| `frontend/src/api/vla.ts` | バックエンド fetch ラッパー |

---

## VLA ポリシー詳細 (`backend/claude_vla.py`)

### 1. Claude への入力構成

```python
messages = [
    {
        "role": "user",
        "content": [
            # (A) Vision: canvas のスクリーンショット
            {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": req.image}},

            # (B) Language: 自然言語指示 + 状態テキスト
            {"type": "text", "text": f'Instruction: "{req.instruction}"\n\n' + _build_state_text(req.state)}
        ]
    }
]
```

`_build_state_text()` が生成するテキストの例:

```
Objects:
  red_0: label=Red Block, color=red, shape=rect [accessible]
  blue_0: label=Blue Block, color=blue, shape=circle [accessible]
  green_0: label=Green Block, color=green, shape=triangle [BLOCKED(something on top)]

Zones:
  zone_a: label=Zone A
  zone_b: label=Zone B

Gripper: TCP=(256,100) openWidth=70 empty
```

**重要**: オブジェクトの `cx`/`cy` 座標は渡していません。Claude は画像を見て自分で推論します。
グリッパーの TCP 座標のみ渡しており、Claude は「自分の手がどこにあるか」を数値で把握します。

### 2. システムプロンプト

#### キャンバス座標系の説明 (`_CANVAS_DESC`)

```
Canvas (512×512 px, Y-axis points DOWN)
- Origin: top-left
- Table surface: y = 440 px
- Block size: 44×44 px, resting center y ≈ 418
- Safe transit height: y = 100
- Gripper TCP = bottom tip of jaws; GRASP picks nearest block within ~50 px
```

重要なポイント:
- Y軸は**下向き**（通常の数学座標と逆）
- テーブル面: y=440、ブロック重心: y≈418
- 安全搬送高度: y=100（テーブルから十分上空）
- クロップ範囲: 半径≈50px 以内のブロックを把持

#### Pick-and-Place 戦略 (`_STRATEGY`)

```
Standard pick-and-place sequence:
1. SET_GRIP(70)              — open gripper
2. MOVE_TCP_TO(obj_x, 100)  — move above object
3. MOVE_TCP_TO(obj_x, 410)  — descend to grasp height
4. GRASP()                  — attach block
5. MOVE_TCP_TO(obj_x, 100)  — lift
6. MOVE_TCP_TO(zone_x, 100) — move above zone
7. MOVE_TCP_TO(zone_x, 420) — lower to place height
8. RELEASE()                — drop block
```

Claude はこの 8 ステップパターンを理解した上で、具体的な座標をオブジェクトの位置に合わせて埋めます。

### 3. Tool Use による構造化出力

free-text パースではなく Anthropic Tool Use API を使い、型安全な JSON を強制します。

#### Open-loop ツール定義 (`submit_plan`)

```python
tools = [{
    "name": "submit_plan",
    "description": "Submit the complete action plan to pick and place the target object",
    "input_schema": {
        "type": "object",
        "properties": {
            "reasoning": {"type": "string"},
            "target_object": {"type": "string"},
            "target_zone": {"type": "string"},
            "actions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "type": {"type": "string", "enum": ["MOVE_TCP_TO","SET_GRIP","GRASP","RELEASE","WAIT"]},
                        "x": {"type": "number"},
                        "y": {"type": "number"},
                        "width": {"type": "number"}
                    },
                    "required": ["type"]
                }
            }
        },
        "required": ["reasoning", "actions"]
    }
}]
```

#### Closed-loop ツール定義 (`next_action`)

```python
tools = [{
    "name": "next_action",
    "description": "Submit the next single action to execute",
    "input_schema": {
        "type": "object",
        "properties": {
            "action_type": {"type": "string",
                           "enum": ["MOVE_TCP_TO","SET_GRIP","GRASP","RELEASE","WAIT","DONE"]},
            "x": {"type": "number"},
            "y": {"type": "number"},
            "width": {"type": "number"},
            "reasoning": {"type": "string"}
        },
        "required": ["action_type", "reasoning"]
    }
}]
```

`DONE` アクション: Claude がタスク完了と判断したとき返す特殊値。バックエンドはこれを `StepResponse(is_done=True)` に変換します。

---

## 2つの動作モード

### Open-loop (`POST /vla/plan`)

```
1. Canvas PNG + WorldState + 指示 → Claude に一括送信
2. Claude が全アクション列を一度に返す (submit_plan ツール)
3. フロントエンドがすべてのアクションをキューに積む
4. 物理シミュレーションがキューを順次実行
```

**特徴**: 高速だが途中のフィードバックなし。環境変化に対応できない。

```
useVLARunner.ts: runOpenLoop()
  │
  ├── callVLA(req) → VLAResponse { actions: [...8 actions...], reasoning: "..." }
  ├── worldRef.enqueueActions(actions)
  └── waitForIdle() → checkSuccess()
```

### Closed-loop (`POST /vla/step`)

```
1. 現在の Canvas PNG + WorldState + 指示 + 直近3ステップ履歴 → Claude に送信
2. Claude が次の1アクションだけ返す (next_action ツール)
3. フロントエンドがその1アクションを実行
4. is_done=true または step>=40 まで繰り返す
```

**特徴**: 実行状況をリアルタイムで見ながら次手を決定。より robust だが API コールが多い。

```
useVLARunner.ts: runClosedLoop() ループ (最大40回)
  │
  ├── callVLAStep(req) → StepResponse { action, reasoning, is_done }
  ├── worldRef.enqueueActions([action])
  ├── waitForIdle()
  └── if is_done → break
```

**履歴ウィンドウ（直近3ステップ）の例**:
```json
[
  {"step": 1, "action": {"type": "MOVE_TCP_TO", "x": 120, "y": 100}, "reasoning": "Moving above red block"},
  {"step": 2, "action": {"type": "MOVE_TCP_TO", "x": 120, "y": 410}, "reasoning": "Descending to grasp height"},
  {"step": 3, "action": {"type": "GRASP"}, "reasoning": "Grasping the red block"}
]
```

---

## データモデル (`backend/models.py`)

```python
class Action(BaseModel):
    type: Literal['MOVE_TCP_TO','SET_GRIP','GRASP','RELEASE','WAIT']
    x: Optional[float] = None   # MOVE_TCP_TO で使用 (canvas px)
    y: Optional[float] = None   # MOVE_TCP_TO で使用 (canvas px)
    width: Optional[float] = None  # SET_GRIP で使用 (0–70 px)
    ms: Optional[int] = None    # WAIT で使用 (将来用)

class SimObject(BaseModel):
    id: str; label: str; color: str
    cx: float; cy: float; w: float; h: float  # canvas px

class GripperState(BaseModel):
    cx: float; cy: float
    openWidth: float        # 0=完全に閉じる, 70=完全に開く
    isGrasping: bool
    graspedId: Optional[str] = None

class WorldState(BaseModel):
    objects: list[SimObject]
    gripper: GripperState
    targetZones: list[TargetZone]
```

---

## 物理シミュレーション (`frontend/src/physics/VLAWorld.ts`)

### 座標系の変換

```
Canvas座標 (px): 原点=左上, Y軸=下向き, 512×512
Physics座標 (m): 原点=左下, Y軸=上向き, スケール 40 px/m

toPhysX(cx) = cx / 40
toPhysY(cy) = (512 - cy) / 40
```

### シーン構成

```
Canvas (512×512 px)
┌─────────────────────────────────────────┐
│            y=100 (safe transit height)  │
│                                         │
│   [RED]        [BLUE]       [GREEN]     │  ← y≈418 (resting)
├──────────────────────────────────────── │  ← y=440 (table surface)
│  [Zone A]     [Zone B]     [Zone C]     │
└─────────────────────────────────────────┘
   x=90         x=256         x=422
```

### アクション実行ロジック

| アクション | 実装 |
|---|---|
| `MOVE_TCP_TO(x, y)` | グリッパーを毎フレーム 6px/step で目標に近づける。距離 < 2px で完了 |
| `SET_GRIP(width)` | `openWidth` を即座に設定。完了まで 1 フレーム |
| `GRASP()` | TCP 付近 (±50px) のブロックを探し、見つかれば Body タイプを `kinematic` に変更してアタッチ |
| `RELEASE()` | Body タイプを `dynamic` に戻し、グリッパーを 70px に開く |

### グリッパーの「把持」実装

グリッパーは物理ボディを持たない**純粋な論理・描画エンティティ**です。把持は以下の方法で実装:

```typescript
// GRASP: ブロックを kinematic に変えてグリッパーに追従させる
grasp(): void {
    const target = this.findNearestBlock(); // TCP から ±50px 以内を探索
    if (target) {
        target.body.setType('kinematic');
        target.body.setLinearVelocity({x: 0, y: 0});
        this.gripper.isGrasping = true;
        this.gripper.graspedId = target.id;
        this.gripper.openWidth = 10;
    }
}

// 毎フレーム: 把持中ブロックをグリッパー TCP に追従
syncGraspedObject(): void {
    if (this.gripper.isGrasping && this.gripper.graspedId) {
        const block = this.getObject(this.gripper.graspedId);
        // TCP の真下 BLOCK_H/2 + 4px にスナップ
        block.body.setPosition(toPhysPos(
            this.gripper.cx,
            this.gripper.cy + BLOCK_H/2 + 4
        ));
    }
}
```

### 成功判定

```typescript
checkSuccess(zoneId: string, objId: string): boolean {
    const zone = this.getZone(zoneId);
    const obj  = this.getObject(objId);
    const inZoneX = Math.abs(obj.cx - zone.cx) <= zone.w/2 + 5;
    const onTable  = obj.cy >= TABLE_TOP_CY - BLOCK_H - 10
                  && obj.cy <= TABLE_TOP_CY + 10;
    return inZoneX && onTable;
}
```

---

## データフロー: 入力から出力まで

### Open-loop (`POST /vla/plan`)

全アクションを一括生成してから実行します。

```
[ユーザー入力]
"Pick up the red block and place it in Zone A"
        │
        ▼
[useVLARunner.ts: runOpenLoop()]
        │
        ├─ canvas.toDataURL("image/png")  →  base64 PNG (512×512)
        └─ VLAWorld.getState()            →  WorldState JSON
               {
                 objects: [{id:"red", label:"Red Block", color:"red",
                            shape:"rect", accessible:true}, ...],  ← cx/cy なし
                 gripper: {cx:256, cy:100, openWidth:70, isGrasping:false},
                 targetZones: [{id:"zone_a", label:"Zone A"}, ...]
               }
        │
        ▼
[POST /api/vla/plan]
        │
        ▼
[FastAPI: claude_vla.py: run_claude_plan()]
        │
        ├─ System: CANVAS_DESC + STRATEGY_VLA  (prompts.py)
        ├─ User:   [image: PNG] + [text: 指示 + WorldState]
        ├─ tools:  [submit_plan]
        └─ tool_choice: "any"  ← ツール呼び出しを強制
        │
        ▼
[Anthropic API: claude-sonnet-4-6]
        │
        ▼
[Tool Use レスポンス (submit_plan)]
    {
      "reasoning": "The red block is at x=120. Zone A is at x=90. I'll pick it up...",
      "actions": [
        {"type": "SET_GRIP",    "width": 70},
        {"type": "MOVE_TCP_TO", "x": 120, "y": 100},
        {"type": "MOVE_TCP_TO", "x": 120, "y": 410},
        {"type": "GRASP"},
        {"type": "MOVE_TCP_TO", "x": 120, "y": 100},
        {"type": "MOVE_TCP_TO", "x": 90,  "y": 100},
        {"type": "MOVE_TCP_TO", "x": 90,  "y": 420},
        {"type": "RELEASE"}
      ]
    }
        │
        ▼
[VLAWorld.enqueueActions(actions)]  ← 全アクションを一括キュー投入
        │
        ▼
[SimCanvas.tsx: rAF ループ ~60fps]
    VLAWorld.step(dt):
        processAction() → 1アクションずつ消化
        world.step(dt)  → Box2D 物理演算
        syncFromPhysics() → ブロック座標更新
        │
        ▼
[waitForIdle()]
        │
        ▼
[checkSuccess()] → recordSuccess() / recordFailure()
```

---

### Closed-loop (`POST /vla/step`)

1アクションごとに画像を撮り直し、Claude が現状を確認しながら次手を決めます。
最大40ステップのループで動作します。

```
[ユーザー入力]
"Pick up the red block and place it in Zone A"
        │
        ▼
[useVLARunner.ts: runClosedLoop()]
        │
        ▼  ┌─────────────────────────────── ループ (step 0〜39) ────────────────────────────────┐
        │  │                                                                                    │
        │  │  ① 現在のキャンバスを撮影                                                            │
        │  │    canvas.toDataURL()  →  base64 PNG                                               │
        │  │                                                                                    │
        │  │  ② WorldState + 直近3ステップ履歴を収集                                              │
        │  │    history = [{step:1, action:{...}, reasoning:"..."}, ...]                        │
        │  │                                                                                    │
        │  │  ③ POST /api/vla/step                                                              │
        │  │      │                                                                             │
        │  │      ▼                                                                             │
        │  │  run_claude_step()                                                                 │
        │  │      ├─ System: CANVAS_DESC + STRATEGY_VLA + STEP_DONE_RULE                       │
        │  │      ├─ User:   [image] + [text: 指示 + WorldState + 直近履歴]                     │
        │  │      ├─ tools:  [next_action]                                                      │
        │  │      └─ tool_choice: "any"                                                        │
        │  │          │                                                                         │
        │  │          ▼                                                                         │
        │  │  [Anthropic API]                                                                   │
        │  │          │                                                                         │
        │  │          ▼                                                                         │
        │  │  Tool Use レスポンス (next_action) ← 1アクションのみ                                │
        │  │      {                                                                             │
        │  │        "action_type": "MOVE_TCP_TO",                                              │
        │  │        "x": 120, "y": 100,                                                        │
        │  │        "reasoning": "Moving above the red block"                                  │
        │  │      }                                                                             │
        │  │          │                                                                         │
        │  │          ▼                                                                         │
        │  │  action_type == "DONE"? ──Yes──→ ループ終了                                        │
        │  │          │ No                                                                      │
        │  │          ▼                                                                         │
        │  │  VLAWorld.enqueueActions([action])  ← 1アクションだけキュー投入                    │
        │  │          │                                                                         │
        │  │          ▼                                                                         │
        │  │  waitForIdle()  ← アクション完了まで待機                                           │
        │  │          │                                                                         │
        │  │          └──────────────────────── 次の step へ ──────────────────────────────────┘
        │
        ▼
[checkSuccess()] → recordSuccess() / recordFailure()
```

**Open-loop との違い**:

| | Open-loop | Closed-loop |
|---|---|---|
| Claude 呼び出し回数 | 1回 | 最大40回 |
| 途中の状態確認 | なし | 毎ステップ画像確認 |
| 実行中のエラー対応 | 不可 | 可能（次ステップで修正） |
| API コスト | 低 | 高 |

---

## 設計上の重要な決定

### 1. "V+L+A" は Claude の中にある

従来のVLAモデル（RT-2, OpenVLA等）はニューラルネットが Vision + Language → Action を内部で学習しています。このプロジェクトでは **Claude 自体がVLAポリシー全体**です。

| 要素 | 担当 |
|---|---|
| Vision (V) | Claude のマルチモーダル入力でキャンバスPNGを解釈 |
| Language (L) | Claude の言語理解で自然言語指示を解釈 |
| Action (A) | Tool Use で構造化アクション列を出力 |

### 2. 座標は画像から推論（オブジェクト座標はJSONに含まれない）

Claude はオブジェクトの `cx`/`cy` を**JSON から受け取りません**。渡す状態テキストにはオブジェクトの色・形状・積み重ね状態のみ含まれます。Claude は画像を見て座標を推論します。

```
┌─────────────────────────────────────────┐
│  JSON で渡す情報                          │
│  ✅ label, color, shape, accessible       │
│  ✅ gripper TCP (cx, cy)                  │
│  ❌ object cx, cy   ← 渡さない            │
│  ❌ zone cx, cy     ← 渡さない            │
└─────────────────────────────────────────┘
         ↓ Claude が画像から推論
  "赤いブロックは x≈120 あたりにある"
  "Zone A は x≈90 あたりにある"
```

これにより:
- 画像の視覚的確認 → どのブロックが「赤」か、どの形状かを判断
- 画像からの座標推論 → 精密な `MOVE_TCP_TO` 座標を生成（誤差あり）
- 「純粋なVLA」 → 視覚入力だけで行動を決定するという設計の実現

### 3. Tool Use = 型安全な Action 出力

```python
# NG: フリーテキストパース（壊れやすい）
response = "MOVE_TCP_TO 120 100\nGRASP\n..."

# OK: Tool Use（型保証）
tool_input = {
    "actions": [
        {"type": "MOVE_TCP_TO", "x": 120, "y": 100},
        {"type": "GRASP"}
    ]
}
```

### 4. グリッパーは物理ボディではない

複雑な関節制約を避けるため、グリッパーは描画・論理オブジェクトのみ。把持は「ブロックをkinematicにしてスナップ追従」という単純な実装で、現実感と実装コストのバランスを取っています。

---

## API エンドポイント仕様

### `POST /vla/plan` (Open-loop)

**Request**:
```json
{
  "instruction": "Pick up the red block and place it in Zone A",
  "image": "<base64 PNG>",
  "state": {
    "objects": [{"id":"red","label":"Red Block","cx":120,"cy":418,"w":44,"h":44,"color":"#e74c3c"}],
    "gripper": {"cx":256,"cy":100,"openWidth":70,"isGrasping":false,"graspedId":null},
    "targetZones": [{"id":"zoneA","label":"Zone A","cx":90,"cy":462,"w":80,"h":44,"color":"..."}]
  }
}
```

**Response**:
```json
{
  "actions": [
    {"type":"SET_GRIP","width":70},
    {"type":"MOVE_TCP_TO","x":120,"y":100},
    {"type":"MOVE_TCP_TO","x":120,"y":410},
    {"type":"GRASP"},
    {"type":"MOVE_TCP_TO","x":120,"y":100},
    {"type":"MOVE_TCP_TO","x":90,"y":100},
    {"type":"MOVE_TCP_TO","x":90,"y":420},
    {"type":"RELEASE"}
  ],
  "reasoning": "The red block is at x=120...",
  "target_object": "red",
  "target_zone": "zoneA"
}
```

### `POST /vla/step` (Closed-loop)

**Request** (前回までの履歴を含む):
```json
{
  "instruction": "Pick up the red block and place it in Zone A",
  "image": "<base64 PNG>",
  "state": { ... },
  "history": [
    {"step":1,"action":{"type":"MOVE_TCP_TO","x":120,"y":100},"reasoning":"Moving above object"},
    {"step":2,"action":{"type":"MOVE_TCP_TO","x":120,"y":410},"reasoning":"Descending"}
  ],
  "step": 3
}
```

**Response**:
```json
{
  "action": {"type":"GRASP"},
  "reasoning": "The gripper is now at grasp height. Grasping the red block.",
  "is_done": false
}
```

---

## 起動方法

```bash
# 1. バックエンド (Docker)
cp .env.example .env
echo "ANTHROPIC_API_KEY=sk-ant-..." >> .env
docker-compose up --build

# 2. フロントエンド (npm)
cd frontend
npm install
npm run dev
# → http://localhost:5173
```

---

