# SPEC_3D.md — VLA Pick&Place Simulator (3D)

## 概要
ブラウザ上で動作する3Dロボット操作シミュレータ。Claude Sonnetがトップダウンカメラ画像とオブジェクト座標を受け取り、自然言語指示に従ってグリッパーを操作する。

---

## スタック

| 要素 | 技術 |
|------|------|
| フレームワーク | React 18 + TypeScript + Vite |
| レンダリング | Three.js (WebGL、PBRマテリアル、シャドウ) |
| 物理エンジン | Rapier3D WASM (`@dimforge/rapier3d-compat`) |
| VLA バックエンド | FastAPI + Claude Sonnet (`claude-sonnet-4-6`) |

---

## 座標系

Y-up、単位: メートル

```
Y (上)
│   Transit height  y = 0.40 m
│
│  [Bin A]  [Bin B]  [Bin C]   z = 0.55 m (テーブル奥)
│   x=-0.35  x=0.0  x=+0.35
│
│  [Obj]   [Obj]   [Obj]       z ≈ 0.0 m (テーブル中央)
│
└─────────────────────────────→ X (右)

テーブル面:    y = 0
把持高さ:      y = 0.04 m  (PICK_Y)
トランジット:  y = 0.40 m  (TRANSIT_Y)
ビン内配置:    y = 0.10 m
```

---

## シーン構成

### オブジェクト (3個)
- 形状: `cube` / `sphere` / `cylinder`
- 初期位置: z ≈ 0、x ≈ [-0.25, 0, +0.25]
- Rapierボディ: Dynamic、密度 600 kg/m³

### ターゲットビン (3個)
| ID | x | z |
|----|---|---|
| `bin_a` | -0.35 | 0.55 |
| `bin_b` | 0.0 | 0.55 |
| `bin_c` | +0.35 | 0.55 |

### グリッパー
- 左右フィンガーを Rapier KinematicPositionBased ボディで実装
- 開口幅: open = 0.10 m、closed = 0.02 m
- GRASP() はオブジェクトをキネマティック付着で把持

---

## アクション空間

| アクション | 引数 | 説明 |
|-----------|------|------|
| `MOVE_TCP_TO(x, y, z)` | meters | TCP をその座標へ補間移動（0.006 m/step） |
| `SET_GRIP(width)` | meters | グリッパー開口幅を設定 |
| `GRASP()` | — | TCP付近のオブジェクトを把持 |
| `RELEASE()` | — | オブジェクトを解放、グリッパーを開く |
| `WAIT` | — | 何もしない |

### 標準ピック＆プレース手順
```
1. SET_GRIP(0.10)              — グリッパーを開く
2. MOVE_TCP_TO(x, 0.40, z)    — オブジェクト上空へ移動
3. MOVE_TCP_TO(x, 0.04, z)    — 把持高さへ降下
4. GRASP()                     — 把持
5. MOVE_TCP_TO(x, 0.40, z)    — 持ち上げ
6. MOVE_TCP_TO(x_bin, 0.40, 0.55) — ビン上空へ移動
7. MOVE_TCP_TO(x_bin, 0.10, 0.55) — ビン内へ降下
8. RELEASE()                   — 解放
```

---

## 観測 (Claude への入力)

- **画像**: トップダウンカメラ（y=2.5、FOV=40°）の512×512 PNG
  - 視野範囲: x=[-0.45, +0.45]、z=[-0.1, +0.65]
  - ※ 色・形状の確認にのみ使用
- **状態 (WorldState3D)**:

```typescript
interface WorldState3D {
  objects: {
    id: string; label: string; color: string
    shape: 'cube' | 'sphere' | 'cylinder'
    accessible: boolean
    x: number   // 現在の中心座標 (meters)
    z: number   // 現在の中心座標 (meters)
  }[]
  gripper: {
    x: number; y: number; z: number
    openWidth: number     // meters
    isGrasping: boolean
    graspedId: string | null
  }
  targetBins: {
    id: string; label: string; color: string
  }[]
}
```

Claude は画像から色・形状を確認し、**座標は state から直接取得**する。

---

## 制御モード

### Open-loop（デフォルト）
1. 画像 + 状態を一度だけ送信
2. Claude が全アクション列を一括生成
3. エグゼキュータが順に実行

### Closed-loop
1. 毎ステップ観察して Claude に送信（直近3ステップの履歴付き）
2. Claude が次の1アクションを返す
3. 実行後に再観察
4. 最大 **40ステップ** で終了

---

## 安全機能

- 存在しないオブジェクトへの指示（色・形状の不一致）→ Claude は即座に `DONE` を返して停止
- 別オブジェクトへの代替は行わない（実世界での危険を想定）

---

## APIエンドポイント

| メソッド | パス | 説明 |
|---------|------|------|
| `POST` | `/api/vla3d/plan` | Open-loop: 全アクション列を生成 |
| `POST` | `/api/vla3d/step` | Closed-loop: 次の1アクションを生成 |

認証: `X-API-Key` ヘッダー（`APP_API_KEY` 環境変数が設定されている場合に必須）

---

## 物理パラメータ (Rapier)

| エンティティ | タイプ | 密度 | 摩擦 | 反発 |
|------------|--------|------|------|------|
| オブジェクト | Dynamic | 600 kg/m³ | 0.8 | 0.15 |
| テーブル | Fixed | — | 0.9 | 0.05 |
| ビン壁 | Fixed | — | 0.7 | 0.05 |
| グリッパーフィンガー | KinematicPositionBased | — | 0.9 | 0.0 |

重力: (0, -9.81, 0) m/s²

---

## 成功判定

オブジェクト重心がビンの XZ 範囲内 かつ y > 0 にある場合に成功とみなす。

---

## メトリクス

```typescript
interface Metrics {
  successRate: number     // 成功率 (0–1)
  avgSteps: number        // 平均ステップ数
  dropCount: number       // テーブル外落下回数 (y < -0.5)
  collisionCount: number
  totalEpisodes: number
  successCount: number
  totalSteps: number
}
```

---

## デプロイ

- **本番**: Render.com（Docker、シングルサービス）
- FastAPI が `backend/static/` に配置したフロントエンドのビルド成果物を配信
- 環境変数: `ANTHROPIC_API_KEY` / `APP_API_KEY` / `VITE_API_KEY` / `ALLOWED_ORIGIN`
