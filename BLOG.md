# 「赤いキューブをビンAに入れて」── Claude でブラウザ完結型 3D ロボットシミュレータを作った

自然言語でロボットを制御する VLA（Vision-Language-Action）をブラウザ上で動く 3D シミュレータとして実装しました。スタックは React + Three.js + Rapier3D WASM + FastAPI + Claude Sonnet。

この記事では実装の詳細より、VLA という概念の面白さと、実際に組んでみて気づいた設計上の判断を中心に書きます。

---

## 作ったもの

```
┌──────────────────────────────────────────────┐
│  指示: [赤いキューブをビンAに入れて      ]    │
│  [▶ Run]  [⏹ Stop]  [↺ Reset]               │
│                                              │
│  ┌──────────────────────────────────────┐    │
│  │     Three.js + Rapier3D              │    │
│  │     物体3個 × ビン3個               │    │
│  │     グリッパーが自律的に動く          │    │
│  └──────────────────────────────────────┘    │
└──────────────────────────────────────────────┘
```

| レイヤー | 技術 |
|---------|------|
| フロントエンド（3D） | React + Three.js + Rapier3D WASM |
| フロントエンド（2D） | React + Planck.js（Box2D） |
| バックエンド | FastAPI（Python） |
| VLA バックエンド | Claude Sonnet（claude-sonnet-4-6） |

---

## VLA とは

### ロボット制御の「汎化問題」

ロボットに物を掴ませるプログラムを書くのは難しくない。難しいのは「どんな物でも掴める」ようにすることで、これをロボティクスでは汎化問題と呼びます。

従来のアプローチは物体検出や姿勢推定をパイプラインで組み合わせて対応してきましたが、照明・物体の種類・背景が変わるたびに再トレーニングが必要で、スケールしない。「赤いキューブ」と「青いシリンダー」を区別するだけで、別のモデルが必要になったりします。

VLA が提案するのは、「知覚から行動まで」を単一のモデルで end-to-end に処理するという方向性です。

### Vision + Language + Action

VLA の三要素——Vision・Language・Action——はもともと別々の研究領域でした。それぞれ物体検出、意味解析、軌道計画といった専門分野があって、統合するのが難しかった。

大規模言語モデルがマルチモーダルになって、この構図が変わりつつあります。Claude Sonnet のように画像とテキストの両方を扱えるモデルであれば、Vision と Language はすでに一つのモデルで処理できる。あとは「Action をどう出力させるか」という問題になります。

### なぜ LLM が VLA に向いているか

単純に「賢いから」というより、学習データの性質がマッチしていると思っています。

インターネット上のテキストには、物体・空間・行動の関係性が大量に含まれている。「左のボックスに入れる」「カップをテーブルに置く」といった記述を通じて、LLM は空間関係と行動の対応を暗黙的に学んでいます。ここに画像の視覚情報が加わることで、「画像を見て状況を把握し、指示に従って行動を計画する」という流れが成立します。

ただし LLM の苦手なことも明確にあって、「x = −0.247m」のような定量的な位置推定は画像からだと ±3〜5cm 程度の誤差が出ます。これをどう補うかが実装上の核心でした。

### 観察→推論→実行のループ

VLA の動作モデルは制御理論のフィードバックループと同じ構造をしています：

```
観察（カメラ画像 + 状態）
    ↓
推論（Claude: 次に何をすべきか）
    ↓
実行（物理シミュレータでアクションを実行）
    ↓
新しい観察 → ...
```

このループをどう回すかで、Closed-loop と Open-loop の2つのモードが生まれます。

---

## 全体アーキテクチャ

```
ブラウザ
  ├─ Three.js + Rapier3D（3D シミュレータ）
  └─ Planck.js + Canvas2D（2D シミュレータ）
       │
       │ POST /api/vla3d/step
       ↓
FastAPI
  └─ Anthropic API（Claude Sonnet）
       │
       │ Tool Use で構造化レスポンス
       ↓
アクション（MOVE_TCP_TO / GRASP / RELEASE / ...）
```

本番では FastAPI がフロントエンドのビルド成果物も静的配信するシングルサービス構成にしました。

---

## 3D シミュレータの設計

### 座標系

Y軸（高さ方向）はこんなレイアウトになっています：

```
y=0.40m ━━━━━━━━━━━━━━━  Transit height
         （物を持ったまま水平移動する高さ。物体同士の衝突を避けるバッファ）

y=0.10m ━━━━━━━━━━━━━━━  ビン内配置高さ
         （ビンの中に物を置くときに降下する高さ）

y=0.04m ━━━━━━━━━━━━━━━  把持高さ
         （物体の中心。高さ 8cm のキューブならテーブルから 4cm の位置）

y=0     ━━━━━━━━━━━━━━━  テーブル面
```

XZ 平面（テーブル面を上から見た配置）：

```
z=0.55  [Bin A]   [Bin B]   [Bin C]    ← テーブル奥のビン
          x=-0.35   x=0     x=+0.35

z=0     [Obj 1]  [Obj 2]  [Obj 3]      ← テーブル中央の物体
          x=-0.25   x=0    x=+0.25
```

物理エンジンは Rapier3D（Rust 製、WASM でブラウザ動作）。ボディタイプを3種類使い分けています：

- `Dynamic` — 物体。重力・衝突の影響を受ける
- `Fixed` — テーブル・ビン壁
- `KinematicPositionBased` — グリッパーフィンガー。コードで位置を直接指定しながら Dynamic ボディを押したり把持できる

### ピック＆プレースの手順

Claude に生成させたいアクション列の雛形：

```
SET_GRIP(0.10)                          ← グリッパーを開く
MOVE_TCP_TO(x_obj, 0.40, z_obj)        ← 物体の真上（Transit 高度）へ
MOVE_TCP_TO(x_obj, 0.04, z_obj)        ← 把持高さへ降下
GRASP()                                 ← 把持
MOVE_TCP_TO(x_obj, 0.40, z_obj)        ← 持ち上げ
MOVE_TCP_TO(x_bin, 0.40, 0.55)         ← ビンの真上へ水平移動
MOVE_TCP_TO(x_bin, 0.10, 0.55)         ← ビン内へ降下
RELEASE()                               ← 解放
```

> **TCP（Tool Center Point）** とはグリッパー先端の制御点のこと。ロボットアームの「手先」をどこに動かすかを指定するときの基準点で、`MOVE_TCP_TO(x, y, z)` はこの点を目標座標へ補間移動させます。

---

## Claude に渡すもの

### 画像とテキスト状態

Claude に渡す観測は2種類。

**画像**：トップダウンカメラ（y=2.5、FOV=40°）の512×512 PNG。

斜め視点だと遠近感で物体の XZ 位置がズレて見えるので、トップダウンにしました。ただ実際のところ、Claude に画像から座標を推定させるつもりはなく（後述）、画像は主に「色・形状の確認」に使います。

**テキスト状態**：

```
Objects:
  red:   label=Red Cube,       shape=cube,     x=−0.250 z=0.000 [accessible]
  blue:  label=Blue Sphere,    shape=sphere,   x=0.000  z=0.000 [accessible]
  green: label=Green Cylinder, shape=cylinder, x=0.250  z=0.000 [accessible]

Target Bins:
  bin_a: label=Bin A, color=red
  bin_b: label=Bin B, color=blue

Gripper: TCP=(0.000, 0.400, 0.000) openWidth=0.100m empty
```

### 座標はテキストで渡す（2D との設計の違い）

`x` と `z` の座標をテキスト状態として直接渡しているのは、意図的な設計です。

実はこのプロジェクトには 2D シミュレータも並行して実装していて、そちらでは**物体の座標を渡していません**。グリッパーの位置だけを渡して、物体がどこにあるかは Claude が画像から推論します。こちらの方が「純粋な VLA」に近い設計です。

ただ 2D でやってみると、Claude の画像からの位置推定には ±数ピクセル〜十数ピクセルの誤差が出ることがわかりました。2D では画面サイズに対して物体が大きいので誤差が吸収されますが、3D でメートル単位の精度が必要な把持動作に同じことをやると把持失敗率がかなり上がります。

なので 3D では役割をきっちり分けました。Claude がやるのは「赤いキューブ」を画像で識別して状態のどのオブジェクトか特定すること。座標はそこから読む。「意味理解は LLM、定量値はシステムが担保」という割り切りです。

---

## Tool Use で行動空間を定義する

Claude への応答形式は Tool Use で固定しています。テキストをパースして数値を取り出す実装は、表現のゆれで壊れるのが目に見えているので。

```python
STEP_TOOLS_3D = [{
    "name": "next_action",
    "input_schema": {
        "properties": {
            "reasoning":   {"type": "string"},
            "action_type": {"enum": ["MOVE_TCP_TO", "SET_GRIP", "GRASP", "RELEASE", "WAIT", "DONE"]},
            "x": {"type": "number"},
            "y": {"type": "number"},
            "z": {"type": "number"},
            "width": {"type": "number"},
        },
        "required": ["reasoning", "action_type"]
    }
}]
```

Tool Use のスキーマが「行動空間の定義」を兼ねていて、Claude はこれを見て使えるアクションを把握します。

`DONE` だけ少し特殊で、ロボットに何かをさせるアクションではなく「タスクを終了する」という Claude からの意思表示です。Closed-loop では Claude が毎ステップ1アクションを返し続けますが、どこかで「もうやることはない」と判断したタイミングで `DONE` を返してループを抜けます。これがないと、システム側はいつループを止めればいいかわかりません。

Claude のレスポンスはこんな感じ：

```json
{
  "reasoning": "赤いキューブは x=−0.25, z=0.0 にある。グリッパーを開いてから上空へ移動する。",
  "action_type": "MOVE_TCP_TO",
  "x": -0.25, "y": 0.40, "z": 0.0
}
```

`reasoning` フィールドを必須にしているのは、デバッグのためです。「Claude は状況を正しく理解しているが実行が失敗している」のか「Claude の推論自体がおかしい」のかを、ログから切り分けられます。

---

## 制御モード（Open-loop vs Closed-loop）

### Open-loop：計画を一括生成して実行する

1回のリクエストで全アクション列を生成し、物理シミュレータにそのまま流し込む方式です。

```
① カメラ画像 + WorldState + 指示 を POST /api/vla3d/plan に送信

② Claude が全アクション列を一括生成（submit_plan ツール）
   {
     "reasoning": "赤いキューブは x=−0.25 にある。ビンAへ運ぶ。",
     "actions": [
       {"type": "SET_GRIP",    "width": 0.10},
       {"type": "MOVE_TCP_TO", "x": -0.25, "y": 0.40, "z": 0.0},
       {"type": "MOVE_TCP_TO", "x": -0.25, "y": 0.04, "z": 0.0},
       {"type": "GRASP"},
       {"type": "MOVE_TCP_TO", "x": -0.25, "y": 0.40, "z": 0.0},
       {"type": "MOVE_TCP_TO", "x": -0.35, "y": 0.40, "z": 0.55},
       {"type": "MOVE_TCP_TO", "x": -0.35, "y": 0.10, "z": 0.55},
       {"type": "RELEASE"}
     ]
   }

③ 全アクションをキューに積んで、物理ループが順次実行
```

Claude を呼ぶのは1回だけなので速くてコストも低い。ただし計画を立てた後の状態変化には対応できません。

### Closed-loop：1ステップずつ観察しながら動く

毎ステップ、現在の状態を撮影して Claude に送り、次の1アクションだけを返してもらう方式です。

```
step 0:
  ① 現在のカメラ画像 + WorldState + 指示 + 履歴[] を送信
  ② Claude → {"action_type": "SET_GRIP", "width": 0.10, "reasoning": "..."}
  ③ 実行・完了待ち

step 1:
  ① 現在のカメラ画像 + WorldState + 指示 + 履歴[step0] を送信
  ② Claude → {"action_type": "MOVE_TCP_TO", "x": -0.25, "y": 0.40, "z": 0.0, "reasoning": "..."}
  ③ 実行・完了待ち

step 2, 3, ... と繰り返す

Claude が {"action_type": "DONE"} を返したらループ終了
最大 40 ステップで強制終了
```

ここで重要なのが**履歴ウィンドウ**です。Claude に直近数ステップの行動履歴を渡すことで、「さっき何をしたか」を把握した上で次の判断ができます。

```json
// POST /api/vla3d/step のリクエストに含まれる履歴
"history": [
  {"step": 0, "action": {"type": "SET_GRIP", "width": 0.10},           "reasoning": "グリッパーを開く"},
  {"step": 1, "action": {"type": "MOVE_TCP_TO", "x": -0.25, ...},      "reasoning": "キューブ上空へ移動"},
  {"step": 2, "action": {"type": "MOVE_TCP_TO", "x": -0.25, "y": 0.04}, "reasoning": "把持高さへ降下"}
]
```

履歴がないと Claude は「自分が今どのステップにいるか」を画像からしか判断できません。履歴を渡すことで、グリッパーが把持済みかどうか、どこから来たかといったコンテキストを維持できます。

### 2つのモードの比較

| | Open-loop | Closed-loop |
|---|---|---|
| Claude 呼び出し | 1回 | 最大 40 回 |
| 途中の状態確認 | なし | 毎ステップ画像確認 |
| 実行中のズレへの対応 | 不可 | 次ステップで修正できる |
| API コスト | 低 | 高 |
| VLA としての性格 | プランナー寄り | フィードバック制御寄り |

Closed-loop が VLA として本来あるべき姿で、実世界では把持時のスリップや測定誤差が常に存在するため、毎ステップ観察して修正できる方が robust です。

Open-loop は「計画能力だけを評価したい」アブレーション（比較実験）として使い道があります。「Claude の推論がおかしいのか、実行精度の問題なのか」を切り分けるには Open-loop の方が見やすい。VLA の論文でも両方の設定で評価するケースが多いので、このシミュレータにも両モード用意しました。

---

## マルチステップ制御で詰まったところ

Closed-loop を実装するとき、一番考えたのは「終了条件をどう設計するか」でした。

### Claude の DONE は「意思表示」であって「事実確認」ではない

Claude が `DONE` を返しても、物体が本当にビンに入っているかはシステム側で確認する必要があります。「置いた」と思っていても物理的にビンの外にはみ出していることがある。なので成功判定は Claude の申告とは独立して、物理エンジンの座標で行っています。

```typescript
if (res.is_done) {
  // Claude が DONE を返した → ループ終了
  // ただし成功かどうかは物理座標で判定
  for (const bin of w.getState().targetBins) {
    for (const obj of w.getState().objects) {
      if (w.checkSuccess(bin.id, obj.id) && !initialSuccesses.has(`${obj.id}:${bin.id}`)) {
        succeeded = true
      }
    }
  }
}
```

### DONE を言っているのにまだ掴んでいる問題

Claude が DONE を返したとき、グリッパーがまだ物体を掴んだままになっているケースがありました。配置動作の最後のステップで DONE と RELEASE を同時に判断してしまうようです。これはシステム側で検出して自動で RELEASE を実行するようにしました。

```typescript
if (res.is_done) {
  if (w.getState().gripper.isGrasping) {
    // Claude が DONE と言っているのにまだ掴んでいる → 強制解放
    w.enqueueActions([{ type: 'RELEASE' }])
    await waitForIdle(worldRef, 800)
  }
}
```

### Claude より先に「成功」を検出する早期終了

毎ステップ Claude に観察を送る前に、「もう成功しているのでは？」をシステム側でチェックしています。

```typescript
if (prevSuccessCount > 0 && !w.getState().gripper.isGrasping && stepsSinceLastSuccess >= 4) {
  succeeded = true
  break  // Claude を呼ばずに終了
}
```

3つの条件がすべて揃ったとき終了します。

- `prevSuccessCount > 0` — 少なくとも1個、ビンへの配置が確認できている
- `!isGrasping` — グリッパーが空（まだ物体を持っていない）
- `stepsSinceLastSuccess >= 4` — 最後に配置が確認できてから4ステップ経過している

`stepsSinceLastSuccess` のカウントはこう動きます：

```
step N:   RELEASE 実行 → 物体がビンに入っているか確認
          → 入っていた: prevSuccessCount++ / stepsSinceLastSuccess = 0（リセット）
          → 入っていなかった: stepsSinceLastSuccess++

step N+1: MOVE_TCP_TO など → stepsSinceLastSuccess++
step N+2: MOVE_TCP_TO など → stepsSinceLastSuccess++
step N+3: MOVE_TCP_TO など → stepsSinceLastSuccess++
step N+4: ループ先頭でチェック → stepsSinceLastSuccess >= 4 → 終了
```

RELEASE の直後は物体が物理的に動いている最中なので、即座に成功判定すると「まだ転がっている途中」を正しく判定できないことがあります。数ステップ待つことで物体が静止してから確認できます。

また RELEASE 以外のアクション（MOVE_TCP_TO など）のあとも `stepsSinceLastSuccess` はカウントアップします。つまり「物体を置けたのに Claude が DONE を言わずに別の操作をしようとしている」状態が4ステップ続いても終了します。Claude が不必要にループを続けてしまうケースへの安全弁です。

---

## まとめ

作ってみて一番実感したのは、「VLA の難しさは AI の部分よりインターフェース設計にある」ということです。

行動空間をどう定義するか（アクションの種類・粒度・パラメータ）、観測に何を含めるか（画像だけか座標も渡すか）、ループをどう回すか（Closed か Open か）——これらの設計判断が Claude の計画品質に直接影響します。

LLM が読んで直感的に理解できるアクション空間であれば Claude も正しく使えるし、曖昧な設計だと Claude の出力も曖昧になる。「大規模言語モデルは自然言語で記述されたインターフェースを理解する」という性質を使っているので、ある意味当たり前なんですが、実際に動かすまで実感しにくい部分でした。

---

**技術スタック**: React / TypeScript / Three.js / Rapier3D WASM / Planck.js / FastAPI / Claude Sonnet
