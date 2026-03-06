export const EXAMPLES: { label: string; items: string[] }[] = [
  {
    label: '色で指定',
    items: [
      '赤の箱を緑のゾーンに入れて',
      'Pick up the blue block and place it in Zone A',
      'Move the green block to Zone B',
      'Put the orange block into Zone C',
    ],
  },
  {
    label: '形状で指定',
    items: [
      'Pick up the circular block and place it in Zone A',
      '三角形のブロックを一番右のゾーンに移動して',
      'Move the triangle-shaped object to Zone B',
      '丸いブロックをZone Cに入れて',
    ],
  },
  {
    label: '位置で指定',
    items: [
      'Move the leftmost block to the rightmost zone',
      '一番右にあるブロックを真ん中のゾーンに移動して',
      'Place the center block into the left zone',
      'Pick up the block on the far left and drop it in Zone A',
    ],
  },
  {
    label: 'マルチステップ',
    items: [
      '赤の箱をZone Cに入れた後、青の箱をZone Aに移動して',
      'First move the triangle to Zone A, then place the circle in Zone B',
      'Sort: put red in Zone A and blue in Zone B',
    ],
  },
  {
    label: '曖昧・難',
    items: [
      'どれか1つのブロックを空いているゾーンに入れて',
      'Put any block into a zone that matches its color',
      'Move the odd-shaped block to the nearest zone',
    ],
  },
]
