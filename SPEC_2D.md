# SPEC_2D.md — VLA Pick&Place Simulator (2D)

## 概要
ブラウザ上で動作する2Dロボット操作シミュレータ。Claude Sonnetが画面キャプチャと状態を受け取り、自然言語指示に従ってグリッパーを操作する。

---

## スタック

| 要素 | 技術 |
|------|------|
| フレームワーク | React 18 + TypeScript + Vite |
| 物理エンジン | Planck.js (Box2D) |
| レンダリング | Canvas 2D API |
| VLA バックエンド | FastAPI + Claude Sonnet (`claude-sonnet-4-6`) |

---

## 座標系

- **Canvas座標**: 原点=左上、Y下向き、512×512 px
- **Physics座標**: 原点=左下、Y上向き、スケール = 40 px/m
- 変換: `toCanvasX(px) = px * 40`, `toCanvasY(py) = 512 - py * 40`

```
Canvas (px)          Physics (m)
┌──────────────┐     Y↑
│ (0,0)        │     │
│       →X     │     │
│       ↓Y     │     └──────→ X
└──────────────┘
      512×512
```

---

## シーン構成

- **テーブル**: y=440px 以下の領域
- **オブジェクト**: 3個（色と形状をランダム化）
  - 形状: `rect` / `circle` / `triangle`
- **ターゲットゾーン**: 3個（テーブル奥に配置）
  - `zone_a` / `zone_b` / `zone_c`
- **グリッパー**: 画面上部中央から開始、最大開口幅 70px

---

## アクション空間

| アクション | 引数 | 説明 |
|-----------|------|------|
| `MOVE_TCP_TO(x, y)` | Canvas px | TCP をその座標へ移動 |
| `SET_GRIP(width)` | Canvas px | グリッパー開口幅を設定（0〜70px） |
| `GRASP()` | — | オブジェクトを把持（TCP付近にある場合） |
| `RELEASE()` | — | オブジェクトを解放 |
| `WAIT` | — | 何もしない |

---

## 観測 (Claude への入力)

- **画像**: Canvas全体のスクリーンショット（base64 PNG、512×512）
- **状態 (WorldState)**:

```typescript
interface WorldState {
  objects: {
    id: string; label: string; color: string
    cx: number; cy: number   // Canvas center px
    w: number; h: number     // bounding box px
    shape: 'rect' | 'circle' | 'triangle'
    accessible: boolean      // 他オブジェクトに遮られていないか
  }[]
  gripper: {
    cx: number; cy: number
    openWidth: number        // 現在の開口幅 (px)
    isGrasping: boolean
    graspedId: string | null
  }
  targetZones: {
    id: string; label: string; color: string
    cx: number; cy: number; w: number; h: number
  }[]
}
```

---

## 制御モード

### Open-loop（デフォルト: Closed-loop）
1. 画像 + 状態を一度だけ送信
2. Claude が全アクション列を一括生成
3. エグゼキュータが順に実行

### Closed-loop
1. 毎ステップ観察して Claude に送信
2. Claude が次の1アクションを返す
3. 実行後に再観察
4. 最大 **40ステップ** で終了

---

## APIエンドポイント

| メソッド | パス | 説明 |
|---------|------|------|
| `POST` | `/api/vla/plan` | Open-loop: 全アクション列を生成 |
| `POST` | `/api/vla/step` | Closed-loop: 次の1アクションを生成 |

認証: `X-API-Key` ヘッダー（`APP_API_KEY` 環境変数が設定されている場合に必須）

---

## 成功判定

オブジェクトの重心がターゲットゾーンの矩形内に収まった場合に成功とみなす。

---

## メトリクス

```typescript
interface Metrics {
  successRate: number     // 成功率 (0–1)
  avgSteps: number        // 平均ステップ数
  dropCount: number       // テーブル外落下回数
  collisionCount: number  // 衝突回数
  totalEpisodes: number
  successCount: number
  totalSteps: number
}
```
