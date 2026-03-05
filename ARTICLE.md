# Claude をロボットの「脳」にする ── 2D VLA Pick & Place シミュレータ

## はじめに

「赤い箱をゾーンAに入れて」──この一言で、AIがロボットアームを動かす。

大規模言語モデル（LLM）の登場によって、これが現実になりつつあります。このプロジェクトは **Claude（Anthropic の AI）をロボットの脳として使い、ブラウザ上で動く 2D ピック＆プレースシミュレータ**です。VLA という概念の入門から、実装の詳細、ハマったバグまで丁寧に解説します。

---

## 第1章：VLA とは何か

### 従来のロボット制御との違い

```
【従来のアプローチ】

プログラマー ──→ 「x=120, y=418 に動け」 ──→ ロボット
               数値を手動で指定

問題点：
- ものの位置が変わるたびに数値を書き直す必要がある
- 「赤い箱」が何かを理解できない
- 想定外の状況に対応できない


【VLA アプローチ】

人間 ──→ 「赤い箱をゾーンAに入れて」 ──→ AI ──→ ロボット
          自然言語で指示          ↑カメラ画像も渡す

AI が以下を自分でやる：
  1. 画像を見て「赤い箱」を探す
  2. どこにあるかをピクセル座標で推定
  3. どう動けばいいかを考える
  4. ロボットへの命令に変換する
```

### VLA = Vision + Language + Action

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│   V ision    ──  カメラ画像を見て状況を把握          │
│                                                     │
│   L anguage  ──  自然言語の指示を理解               │
│                                                     │
│   A ction    ──  ロボットの行動を生成               │
│                                                     │
└─────────────────────────────────────────────────────┘

この3つをひとつのモデルで処理するのが VLA
```

---

## 第2章：このプロジェクトの全体像

### デモ画面の構成

```
┌──────────────────────────────────────────────────────────────────┐
│  VLA Pick & Place Simulator                     [THINKING] 🤖    │
├────────────────────────────────┬─────────────────────────────────┤
│                                │  📊 Metrics                     │
│  ┌──────────────────────────┐  │  ─────────────────────────────  │
│  │     シミュレーション      │  │  成功率: 85%  平均ステップ: 12  │
│  │   ┌──┐                   │  │                                 │
│  │   │🔧│  ← グリッパー     │  │  📋 Log                        │
│  │   └──┘                   │  │  ─────────────────────────────  │
│  │                           │  │  [18:41] 🔍 Step 0 (初期確認) │
│  │  🟥  🔵  🟢              │  │  [18:41] 🤖 MOVE_TCP_TO(120,.. │
│  │  red  blue  green  ← ブロック  │  [18:41] 📦 Red → Zone C 済  │
│  │                           │  │  [18:41] ✅ Claude DONE        │
│  │  [ZoneA] [ZoneB] [ZoneC]  │  │  [18:41] 🎉 成功！             │
│  └──────────────────────────┘  │                                 │
│                                │  🎮 Action Space                │
│  [🔁 Closed] [⚡ Open]         │  MOVE_TCP_TO(x, y)              │
│  指示: [赤の箱をZone Cに入れて ] │  GRASP()                       │
│  [▶ Run] [↺ Reset] [🎲 Rand]  │  RELEASE()                      │
└────────────────────────────────┴─────────────────────────────────┘
```

### 技術スタック

```
┌─────────────────────────────────────────────────────┐
│                  ブラウザ (React + TypeScript)        │
│                                                     │
│  ┌──────────────┐  ┌──────────────┐                 │
│  │  SimCanvas   │  │ ControlPanel │                 │
│  │  (Canvas描画) │  │ (UI・入力)   │                 │
│  └──────┬───────┘  └──────┬───────┘                 │
│         │                 │                         │
│  ┌──────▼─────────────────▼───────┐                 │
│  │      useVLARunner (Hook)       │                 │
│  │    ループ制御・状態管理         │                 │
│  └──────────────┬─────────────────┘                 │
│                 │ HTTP fetch                        │
└─────────────────┼───────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────┐
│              FastAPI (Python)                       │
│                                                     │
│    POST /vla/step    POST /vla/plan                 │
│         │                  │                        │
│    run_claude_step   run_claude_plan                │
└─────────────────┬───────────────────────────────────┘
                  │ Anthropic API
┌─────────────────▼───────────────────────────────────┐
│           Claude Sonnet (Multimodal)                │
│      画像 + テキスト → ツール呼び出し               │
└─────────────────────────────────────────────────────┘
```

---

## 第3章：行動空間の設計

Claude にロボットを動かさせるには、まず「何ができるか」を定義します。これを**行動空間**と呼びます。

### 4つの基本行動

```
┌─────────────────────────────────────────────────────┐
│              Action Space（行動空間）                 │
│                                                     │
│  MOVE_TCP_TO(x, y)                                  │
│  ┌────────────────┐                                 │
│  │    ───→ ⊕     │  グリッパー先端を (x, y) へ移動  │
│  │           ↓    │  TCP = Tool Center Point         │
│  └────────────────┘                                 │
│                                                     │
│  SET_GRIP(width)                                    │
│  ┌────────────────┐                                 │
│  │  | width=70 |  │  グリッパーの開き幅を設定        │
│  │  |  wide    |  │  0=完全に閉じる 70=最大開放      │
│  └────────────────┘                                 │
│                                                     │
│  GRASP()                                            │
│  ┌────────────────┐                                 │
│  │  [■] → ████   │  近くのブロックを掴む            │
│  └────────────────┘                                 │
│                                                     │
│  RELEASE()                                          │
│  ┌────────────────┐                                 │
│  │  ████ → [■]   │  掴んでいるブロックを放す        │
│  └────────────────┘                                 │
└─────────────────────────────────────────────────────┘
```

### 典型的なピック＆プレースの動作手順

```
     ⊕  ← グリッパー初期位置（安全高度 y=100）
     │
     │ ① MOVE_TCP_TO(120, 100)  真上へ
     │
     ▼
     ⊕ ← y=100（安全高度）
     │
     │ ② MOVE_TCP_TO(120, 418)  ブロックまで降下
     │
     ▼
    ⊞⊕⊟  ← y=418（ブロック位置）
    [🟥]

     ③ GRASP()  掴む
    ⊞◼⊟  ← グリッパーが閉じる
    [🟥]

     ④ MOVE_TCP_TO(120, 100)  持ち上げ
     ⊞◼⊟  ← y=100
     [🟥]

     ⑤ MOVE_TCP_TO(415, 100)  ゾーン上へ水平移動
          ⊞◼⊟ ← y=100, x=415
          [🟥]

     ⑥ MOVE_TCP_TO(415, 420)  配置高度まで降下
          ⊞◼⊟
          [🟥] ← y=420

     ⑦ RELEASE()  放す
          ⊞  ⊟
          [🟥] ← テーブルに着地
```

---

## 第4章：Claude への指示設計（プロンプトエンジニアリング）

### 渡す情報の構成

```
┌──────────────────────────────────────────────────────┐
│                Claude へのリクエスト                  │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │              画像（base64 PNG）                 │  │
│  │                                                │  │
│  │  [キャンバスのスクリーンショット]               │  │
│  │   ブロックの位置・色・形状が写っている          │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │              テキスト情報                       │  │
│  │                                                │  │
│  │  Step 5 | Instruction: "赤の箱をZone Cへ"     │  │
│  │                                                │  │
│  │  Objects:                                      │  │
│  │    red:   label=Red Block, color=#e74c3c,      │  │
│  │           shape=rect [accessible]              │  │
│  │    blue:  label=Blue Block, color=#3498db,     │  │
│  │           shape=circle [BLOCKED]  ←上に何か乗ってる│
│  │                                                │  │
│  │  Zones:                                        │  │
│  │    zone_c: label=Zone C                        │  │
│  │                                                │  │
│  │  Gripper: TCP=(256, 100) openWidth=70 empty   │  │
│  │                                                │  │
│  │  Recent history:                               │  │
│  │    step 3: MOVE_TCP_TO(120, 100) — 赤の上へ   │  │
│  │    step 4: MOVE_TCP_TO(120, 418) — 降下中      │  │
│  └────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

### ポイント：座標は渡さない（これが VLA の肝）

```
❌ LA（なんちゃって VLA）の場合
  「red block は x=120, y=418 にある」と座標を教える
  → Claude は数値をそのまま使うだけ
  → 画像を「見て」いない

✅ VLA の場合
  「No pixel coordinates are provided.
   Carefully examine the image to estimate the position.」
  → Claude が画像から座標を自分で推定する
  → 本当に Vision を使っている
```

### システムプロンプトの構成

```
┌─────────────────────────────────────────────────────┐
│                 System Prompt                       │
│                                                     │
│  ① ロール定義                                       │
│  "You are a robot manipulation policy."             │
│                                                     │
│  ② キャンバス情報（物理的制約）                     │
│  Canvas: 512×512px, Y軸下向き                       │
│  テーブル面: y=440, ブロック中心: y≈418              │
│  安全高度: y=100                                    │
│                                                     │
│  ③ 標準手順（ピック＆プレース）                     │
│  1. SET_GRIP(70) → 2. MOVE above → 3. Descend      │
│  4. GRASP → 5. Lift → 6. Move over zone             │
│  7. Lower → 8. RELEASE                             │
│                                                     │
│  ④ アンスタック手順（積み重ね解除）                 │
│  BLOCKED なら：邪魔なブロックを一時退避 →           │
│  ターゲット配置 → 邪魔ブロックを元の位置に戻す       │
│                                                     │
│  ⑤ 完了ルール                                      │
│  Step 0 でタスクが既に完了なら即 DONE              │
│  全ブロック配置完了後に DONE                        │
└─────────────────────────────────────────────────────┘
```

---

## 第5章：Tool Use による構造化出力

Claude に「次の行動は？」と聞くだけでは文章が返ってきます。ロボット制御には数値が必要です。**Anthropic の Tool Use API** を使って、決まったフォーマットで返答させます。

### 通常の LLM 応答 vs Tool Use

```
【通常の応答】
Claude: "I would move the gripper to the position above
         the red block at approximately x=120, then descend..."

問題：テキストを解析して数値を取り出す処理が必要
     → 不安定、エラーが起きやすい


【Tool Use を使った応答】
Claude が呼び出すツール: next_action
{
  "reasoning": "グリッパーをブロックの真上に移動する",
  "action_type": "MOVE_TCP_TO",
  "x": 120,
  "y": 100
}

利点：型安全、追加の解析不要、確実に構造化されている
```

### ツールスキーマの定義

```python
STEP_TOOLS = [{
    "name": "next_action",
    "input_schema": {
        "properties": {
            "reasoning":   str,   # Claude の思考過程（デバッグに便利）
            "action_type": enum,  # MOVE_TCP_TO / GRASP / RELEASE / DONE
            "x": number,          # MOVE_TCP_TO のとき使う
            "y": number,
            "width": number,      # SET_GRIP のとき使う
        }
    }
}]
```

### reasoning フィールドの活用

```
Claude の reasoning（実際のログより）：

"The gripper is holding the blue block and is at TCP=(90,100).
I need to check the instruction order: 赤の箱をZone Cに入れた後、
青の箱をZone Aに移動して. Since I'm already holding blue,
the most efficient approach: place blue in Zone A now (its final
destination), then pick up red and place it in Zone C."

→ AI の思考過程が丸見えになるので、デバッグが楽
→ 「なぜその行動を選んだか」が一目でわかる
```

---

## 第6章：クローズドループ vs オープンループ

### オープンループ（一括生成）

```
┌──────────────────────────────────────────────┐
│             オープンループ                     │
│                                              │
│  撮影 ──→ Claude ──→ [全アクション列]        │
│                                              │
│   (1回のAPI呼び出し)                          │
│                                              │
│  [MOVE, GRASP, MOVE, RELEASE, MOVE, ...]    │
│        ↓                                     │
│   そのまま順番に実行                          │
│                                              │
│  ✅ API呼び出し1回でOK（コスト低）            │
│  ❌ 途中の状態変化に対応できない              │
│  ❌ 物理演算のズレが蓄積すると失敗する        │
└──────────────────────────────────────────────┘
```

### クローズドループ（逐次観測）

```
┌──────────────────────────────────────────────┐
│            クローズドループ                    │
│                                              │
│  step 0:  撮影 → Claude → MOVE_TCP_TO(120,100)│
│              ↓ 実行・物理シミュレーション      │
│  step 1:  撮影 → Claude → MOVE_TCP_TO(120,418)│
│              ↓ 実行                          │
│  step 2:  撮影 → Claude → GRASP()            │
│              ↓ 実行                          │
│  step 3:  撮影 → Claude → MOVE_TCP_TO(120,100)│
│              ↓ 実行                          │
│             ...                              │
│  step N:  撮影 → Claude → DONE              │
│                                              │
│  ✅ 毎ステップ現在の状態を観測できる          │
│  ✅ ズレがあっても修正できる                  │
│  ❌ ステップ数だけ API 呼び出しが発生する     │
└──────────────────────────────────────────────┘
```

### 早期終了ロジック

API コストを節約するため、複数の終了条件を実装しています。

```
優先度 ①：観測前チェック
  条件: グリッパー空 AND 新規配置済みブロックあり AND
        最後の RELEASE から 4 ステップ以上変化なし
  → Claude に聞かずに即終了

優先度 ②：Claude の DONE シグナル
  Claude が action_type: "DONE" を返したら終了

優先度 ③：最大ステップ数
  MAX_STEPS = 40 を超えたら強制終了


【なぜ閾値が 4 ステップなのか】

RELEASE 後、マルチステップタスクでは次のブロックを掴みに行く：

  step N+1: MOVE_TCP_TO (安全高度へ)
  step N+2: MOVE_TCP_TO (次ブロック上へ)
  step N+3: MOVE_TCP_TO (降下)
  step N+4: GRASP       ← このステップで isGrasping = true になる

4 ステップ待てば、まだ次のタスクがある場合は
必ず gripper.isGrasping が true になっているので誤終了しない
```

---

## 第7章：物理エンジンとの統合

### 2 つの座標系

```
┌─────────────────────────────────────────────────┐
│           座標系の対応関係                       │
│                                                 │
│  Canvas 座標（Claude が使う）                   │
│  ┌─────────────────────────────┐               │
│  │(0,0)──────────────→ x(512) │               │
│  │  │                         │               │
│  │  │  ブロック(120, 418)      │               │
│  │  │       [🟥]              │               │
│  │  ↓                         │               │
│  │ y(512)  テーブル(y=440)     │               │
│  └─────────────────────────────┘               │
│                                                 │
│  Physics 座標（Planck.js が使う）               │
│  ┌─────────────────────────────┐               │
│  │ y(12.8m) ──────────────     │               │
│  │  ↑                         │               │
│  │  │  ブロック(3.0m, 2.35m)   │               │
│  │  │       [🟥]              │               │
│  │  │  テーブル(y=1.8m)        │               │
│  │(0,0)──────────────→ x(12.8m)│              │
│  └─────────────────────────────┘               │
│                                                 │
│  変換式：                                       │
│  physX = canvasX / 40                          │
│  physY = (512 - canvasY) / 40  ← Y軸を反転     │
└─────────────────────────────────────────────────┘
```

### 把持（GRASP）の実装

物理エンジンには「掴む」という概念がないため、ハック的な実装になっています。

```
【把持の実装方法】

通常（dynamic ボディ）：
  ブロック ──→ 重力・衝突の影響を受ける
              物理エンジンが位置を計算する

GRASP 後（kinematic ボディ）：
  ブロック ──→ 物理演算の対象外になる
              コードで位置を直接制御できる

┌──────────────────────────────────────────┐
│ GRASP の処理フロー                        │
│                                          │
│ 1. 最近傍ブロックを探す（50px以内）       │
│ 2. ボディを dynamic → kinematic に変更    │
│ 3. gripper.cy をブロック位置に合わせてスナップ│
│    （ここでスナップしないとブロックが沈む）  │
│ 4. isGrasping = true                    │
│ 5. 毎フレーム syncGraspedObject() が実行  │
│    → ブロック位置 = gripper 位置 + offset │
│                                          │
│ RELEASE の処理フロー                      │
│                                          │
│ 1. kinematic → dynamic に戻す            │
│ 2. 速度を 0 にリセット                   │
│ 3. isGrasping = false                   │
│ 4. 以降は物理エンジンが自然落下を処理    │
└──────────────────────────────────────────┘
```

### 積み重ねの検出

```
アクセス可能性チェックの仕組み

  [Blue Block]  ← これが上に乗っている
  [Red Block]   ← アクセス不可（accessible=false）

判定ロジック：
  ┌────────────────────────────────┐
  │ 他のブロックの底面              │
  │     ↕ この距離が 12px 以下 AND │
  │ 対象ブロックの天面              │
  │     X 方向の重なりが 70% 以上  │
  │     → accessible = false      │
  └────────────────────────────────┘

Claude にはこの情報をテキストで渡す：
  blue: shape=circle [BLOCKED(something on top)]
  red:  shape=rect   [accessible]
```

---

## 第8章：実装で直面した課題集

### 課題1：NaN が JSON で null になる

```
JavaScript の罠：

  NaN を JSON.stringify すると → null になる！

  { x: NaN } → JSON → { "x": null }
              ↓ FastAPI に送信
  ValidationError: "x" must be float, got null

解決策：
  getState() で NaN をサニタイズして返す

  cx: isFinite(o.cx) ? o.cx : 0,
  cy: isFinite(o.cy) ? o.cy : TABLE_TOP_CY - BLOCK_H / 2,
```

### 課題2：マルチステップで早期終了

```
問題：
  指示「赤→ZoneC、青→ZoneA」

  step 8: RELEASE 赤 (ZoneC) 成功！
  step 9: 観測前チェック...
          prevSuccessCount = 1 > 0
          gripperEmpty = true
          stepsSinceLastSuccess = 1 < 4 ← まだ閾値に達していない
          → 中断しない ✅
  step 12: GRASP 青（gripperEmpty = false）
          → 中断しない ✅
  step 14: RELEASE 青 (ZoneA) 成功！
  step 15: 観測前チェック...
           stepsSinceLastSuccess = 1 < 4 → 中断しない
           Claude → DONE → 正常終了 ✅

閾値 4 が絶妙なバランスポイントだった
```

### 課題3：GRASP 時にブロックが沈む

```
問題の原因：

  GRASP 前：グリッパー cy = 423 (obj_cy + 5)
            ブロック  cy = 418

  GRASP 後：syncGraspedObject が実行される
            block.cy = gripper.cy + h/2 + 4
                     = 423 + 22 + 4
                     = 449  ← テーブル面(440)の下に埋まる！

解決策：
  GRASP 時にグリッパーの cy をスナップ

  this.gripper.cy = nearestObj.cy - nearestObj.h / 2 - 4
                  = 418 - 22 - 4
                  = 392

  その後 syncGraspedObject：
  block.cy = 392 + 22 + 4 = 418  ← 元の位置のまま ✅
```

### 課題4：Claude が DONE を忘れて RELEASE を省略

```
問題：
  Claude の reasoning には「Zone A に配置した」と書いてあるのに
  action_type: DONE を返す（RELEASE をせずに）

  → ブロックがグリッパーに握られたまま成功判定 → 失敗！

解決策：
  DONE 受信時に isGrasping をチェックして自動リリース

  if (res.is_done) {
    if (world.getState().gripper.isGrasping) {
      world.enqueueActions([{ type: 'RELEASE' }])
      await waitForIdle(worldRef, 800)
    }
    // 成功チェック...
  }
```

---

## 第9章：コードの構成

### バックエンド（Python）

```
backend/
  ├── main.py        API エンドポイント（薄いルーティング層）
  ├── claude_vla.py  Claude API 呼び出しロジック
  ├── prompts.py     プロンプト文字列・ツールスキーマ（定数として分離）
  └── models.py      Pydantic データモデル

役割分担：
  main.py     → HTTP を受け取って claude_vla.py に渡すだけ
  claude_vla.py → API 呼び出し・レスポンス解析
  prompts.py  → プロンプトを定数として管理（変更しやすく）
  models.py   → リクエスト/レスポンスの型定義
```

### フロントエンド（TypeScript）

```
frontend/src/
  ├── App.tsx                   トップレベル（70行程度の薄いラッパー）
  │
  ├── hooks/
  │   └── useVLARunner.ts       ループ制御・状態管理（カスタム Hook）
  │
  ├── components/
  │   ├── SimCanvas.tsx         Canvas 描画 + 物理ステップ
  │   ├── ControlPanel.tsx      指示入力・ボタン群
  │   └── MetricsPanel.tsx      成功率・統計表示
  │
  ├── physics/
  │   ├── VLAWorld.ts           物理世界・アクション実行エンジン
  │   └── types.ts              型定義・座標変換
  │
  ├── api/vla.ts                バックエンドとの HTTP 通信
  └── constants/examples.ts     例文一覧
```

### データの流れ

```
ユーザーが「Run」を押す
        ↓
useVLARunner.handleRun()
        ↓
captureRef.current()  ← Canvas を PNG として撮影
        ↓
world.getState()      ← ブロック位置・グリッパー状態を取得
        ↓
POST /vla/step (画像 + 状態 + 指示 + 履歴)
        ↓
Claude API (画像 + テキスト → ツール呼び出し)
        ↓
{ action_type: "MOVE_TCP_TO", x: 120, y: 100, reasoning: "..." }
        ↓
world.enqueueActions([action])  ← アクションをキューに積む
        ↓
requestAnimationFrame ループで物理シミュレーション実行
        ↓
waitForIdle()  ← キューが空になるまで待機
        ↓
次のステップへ（クローズドループの場合）
```

---

## まとめ

### このプロジェクトで実現できたこと

```
✅ 自然言語（日本語・英語）でロボットを操作
✅ Claude が画像から物体位置を自力で推定（座標は渡さない）
✅ 積み重なったブロックのアンスタック
✅ マルチステップタスク（「赤→C、次に青→A」）
✅ クローズドループによる状態追従
✅ 物理エンジンでリアルな衝突・重力・摩擦
✅ 多様な形状（rect / circle / triangle）への対応
```

### VLA から学んだ設計原則

```
1. 行動空間は小さく保つ
   4 つのアクションでほぼ何でもできる

2. Tool Use で構造化出力を強制する
   テキスト解析は壊れやすい

3. テキスト補助 + 画像の組み合わせが強い
   画像だけでも言語だけでも不十分

4. Claude の reasoning を必ず取得する
   デバッグの命綱

5. 終了条件は複数用意する
   Claude の DONE だけに頼るとエッジケースで詰まる
```

### 今後の拡張アイデア

- **3D シミュレータ**への拡張（Three.js + Cannon.js）
- **マルチエージェント**：複数のロボットアームを協調させる
- **学習ループ**：成功・失敗を記録して Claude へのコンテキストを改善
- **実機接続**：シリアル通信で実際のロボットアームに命令を送る

---

大規模言語モデルが「目」と「手」を持つ時代は、すでに始まっています。
このシミュレータはその入り口を 2D でコンパクトに体験できる場所です。

---

*技術スタック: React / TypeScript / Planck.js / FastAPI / Python / Anthropic Claude API*
