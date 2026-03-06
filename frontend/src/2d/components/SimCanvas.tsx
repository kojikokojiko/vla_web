import { useEffect, useRef, useCallback, useState } from 'react'
import { VLAWorld } from '../physics/VLAWorld'
import { CANVAS_W, CANVAS_H, TABLE_TOP_CY as TABLE_TOP_CY_CONST } from '../physics/types'

interface HoverInfo {
  canvasX: number
  canvasY: number
  nearestLabel: string | null
}

interface Props {
  worldRef: React.MutableRefObject<VLAWorld | null>
  captureRef: React.MutableRefObject<() => string>
}

export default function SimCanvas({ worldRef, captureRef }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animRef = useRef<number>(0)
  const lastTimeRef = useRef<number>(0)
  const [hover, setHover] = useState<HoverInfo | null>(null)
  const [loopError, setLoopError] = useState<string | null>(null)

  const draw = useCallback((ctx: CanvasRenderingContext2D) => {
    const w = worldRef.current
    if (!w) return
    const state = w.getState()
    const { objects, gripper: g, targetZones } = state

    // Background
    ctx.fillStyle = '#16213e'
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.04)'
    ctx.lineWidth = 1
    for (let x = 0; x < CANVAS_W; x += 32) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, CANVAS_H); ctx.stroke()
    }
    for (let y = 0; y < CANVAS_H; y += 32) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CANVAS_W, y); ctx.stroke()
    }

    // Table
    ctx.fillStyle = '#2c3e50'
    ctx.fillRect(0, TABLE_TOP_CY_CONST, CANVAS_W, CANVAS_H - TABLE_TOP_CY_CONST)
    ctx.strokeStyle = '#546e7a'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(0, TABLE_TOP_CY_CONST)
    ctx.lineTo(CANVAS_W, TABLE_TOP_CY_CONST)
    ctx.stroke()

    // Target zones
    for (const zone of targetZones) {
      const x = zone.cx - zone.w / 2
      const y = zone.cy - zone.h / 2
      ctx.fillStyle = zone.color
      ctx.fillRect(x, y, zone.w, zone.h)
      ctx.strokeStyle = zone.color.replace('0.25', '0.7')
      ctx.lineWidth = 2
      ctx.setLineDash([6, 3])
      ctx.strokeRect(x, y, zone.w, zone.h)
      ctx.setLineDash([])
      ctx.fillStyle = 'rgba(255,255,255,0.85)'
      ctx.font = 'bold 11px monospace'
      ctx.textAlign = 'center'
      ctx.fillText(zone.label, zone.cx, zone.cy + 5)
    }

    // Objects
    for (const obj of objects) {
      const shape = obj.shape ?? 'rect'

      // シェイプのパスを生成するヘルパー
      const buildPath = (offsetX = 0, offsetY = 0) => {
        ctx.beginPath()
        if (shape === 'circle') {
          ctx.arc(obj.cx + offsetX, obj.cy + offsetY, obj.w / 2, 0, Math.PI * 2)
        } else if (shape === 'triangle') {
          ctx.moveTo(obj.cx + offsetX,           obj.cy - obj.h / 2 + offsetY)
          ctx.lineTo(obj.cx - obj.w / 2 + offsetX, obj.cy + obj.h / 2 + offsetY)
          ctx.lineTo(obj.cx + obj.w / 2 + offsetX, obj.cy + obj.h / 2 + offsetY)
          ctx.closePath()
        } else {
          ctx.rect(obj.cx - obj.w / 2 + offsetX, obj.cy - obj.h / 2 + offsetY, obj.w, obj.h)
        }
      }

      // Shadow
      ctx.fillStyle = 'rgba(0,0,0,0.3)'
      buildPath(4, 4)
      ctx.fill()

      // Body
      ctx.fillStyle = obj.color
      buildPath()
      ctx.fill()

      // Highlight (clip to shape)
      ctx.save()
      buildPath()
      ctx.clip()
      ctx.fillStyle = 'rgba(255,255,255,0.2)'
      ctx.fillRect(obj.cx - obj.w / 2, obj.cy - obj.h / 2, obj.w, 8)
      ctx.restore()

      // Border
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'
      ctx.lineWidth = 1.5
      buildPath()
      ctx.stroke()

      // Label
      ctx.fillStyle = '#fff'
      ctx.font = 'bold 10px monospace'
      ctx.textAlign = 'center'
      ctx.fillText(obj.label.split(' ')[0], obj.cx, obj.cy + 4)
    }

    // Gripper
    const jawLen = 28
    const jawThick = 8
    const halfOpen = g.openWidth / 2

    // Arm
    ctx.strokeStyle = '#78909c'
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.moveTo(g.cx, 0)
    ctx.lineTo(g.cx, g.cy - jawLen - 10)
    ctx.stroke()

    // Center block
    ctx.fillStyle = g.isGrasping ? '#f39c12' : '#ecf0f1'
    ctx.strokeStyle = '#2c3e50'
    ctx.lineWidth = 2
    ctx.fillRect(g.cx - 12, g.cy - jawLen - 10, 24, 20)
    ctx.strokeRect(g.cx - 12, g.cy - jawLen - 10, 24, 20)

    // Jaws
    ctx.fillStyle = g.isGrasping ? '#e67e22' : '#bdc3c7'
    ctx.fillRect(g.cx - halfOpen - jawThick, g.cy - jawLen, jawThick, jawLen)
    ctx.strokeRect(g.cx - halfOpen - jawThick, g.cy - jawLen, jawThick, jawLen)
    ctx.fillRect(g.cx + halfOpen, g.cy - jawLen, jawThick, jawLen)
    ctx.strokeRect(g.cx + halfOpen, g.cy - jawLen, jawThick, jawLen)

    // TCP crosshair
    ctx.strokeStyle = g.isGrasping ? '#f39c12' : 'rgba(255,255,255,0.5)'
    ctx.lineWidth = 1
    ctx.setLineDash([3, 3])
    ctx.beginPath()
    ctx.moveTo(g.cx - 8, g.cy); ctx.lineTo(g.cx + 8, g.cy)
    ctx.moveTo(g.cx, g.cy - 8); ctx.lineTo(g.cx, g.cy + 8)
    ctx.stroke()
    ctx.setLineDash([])

    if (g.isGrasping && g.graspedId) {
      ctx.fillStyle = '#f39c12'
      ctx.font = '11px monospace'
      ctx.textAlign = 'left'
      ctx.fillText(`⚙ ${g.graspedId}`, g.cx + halfOpen + jawThick + 4, g.cy + 4)
    }

    // Debug: action queue
    const dbg = w.getDebugInfo()
    ctx.fillStyle = 'rgba(0,0,0,0.5)'
    ctx.fillRect(4, 4, 180, 36)
    ctx.fillStyle = '#64b5f6'
    ctx.font = '10px monospace'
    ctx.textAlign = 'left'
    ctx.fillText(`queue: ${dbg.queueLength}  action: ${dbg.currentAction ?? 'idle'}`, 8, 16)
    ctx.fillText(`tcp: (${dbg.gripperCx}, ${dbg.gripperCy})`, 8, 28)
  }, [worldRef])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!

    const loop = (time: number) => {
      const dt = time - lastTimeRef.current
      lastTimeRef.current = time
      try {
        if (worldRef.current) worldRef.current.step(dt || 16)
        draw(ctx)
      } catch (e) {
        console.error('[SimCanvas loop]', e)
        setLoopError(String(e))
      }
      animRef.current = requestAnimationFrame(loop)
    }
    animRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(animRef.current)
  }, [draw, worldRef])

  useEffect(() => {
    captureRef.current = () => canvasRef.current?.toDataURL('image/png') ?? ''
  }, [captureRef])

  // マウスホバー: Canvas座標を表示
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const scaleX = CANVAS_W / rect.width
    const scaleY = CANVAS_H / rect.height
    const cx = Math.round((e.clientX - rect.left) * scaleX)
    const cy = Math.round((e.clientY - rect.top) * scaleY)

    // 最近傍オブジェクト/ゾーンを検索
    const w = worldRef.current
    let nearestLabel: string | null = null
    if (w) {
      const state = w.getState()
      for (const obj of state.objects) {
        if (Math.abs(obj.cx - cx) < obj.w / 2 && Math.abs(obj.cy - cy) < obj.h / 2) {
          nearestLabel = obj.label
          break
        }
      }
      if (!nearestLabel) {
        for (const zone of state.targetZones) {
          if (Math.abs(zone.cx - cx) < zone.w / 2 && Math.abs(zone.cy - cy) < zone.h / 2) {
            nearestLabel = zone.label
            break
          }
        }
      }
    }
    setHover({ canvasX: cx, canvasY: cy, nearestLabel })
  }, [worldRef])

  const handleMouseLeave = useCallback(() => setHover(null), [])

  return (
    <div style={{ position: 'relative', width: 'fit-content' }}>
      <canvas
        ref={canvasRef}
        width={CANVAS_W}
        height={CANVAS_H}
        style={{ border: '2px solid #2c3e50', borderRadius: 8, display: 'block', cursor: 'crosshair', width: 640, height: 640 }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />

      {/* ホバー座標 tooltip */}
      {hover && (
        <div style={{
          position: 'absolute',
          bottom: 8,
          left: 8,
          background: 'rgba(0,0,0,0.75)',
          color: '#e0e0e0',
          fontSize: 11,
          fontFamily: 'monospace',
          padding: '4px 8px',
          borderRadius: 4,
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
        }}>
          x: {hover.canvasX}, y: {hover.canvasY}
          {hover.nearestLabel && (
            <span style={{ color: '#64b5f6', marginLeft: 8 }}>← {hover.nearestLabel}</span>
          )}
        </div>
      )}

      {/* エラー表示 */}
      {loopError && (
        <div style={{
          position: 'absolute',
          top: 8, left: 8, right: 8,
          background: 'rgba(231,76,60,0.85)',
          color: '#fff',
          fontSize: 11,
          padding: '6px 10px',
          borderRadius: 4,
          fontFamily: 'monospace',
        }}>
          ⚠ Loop error: {loopError}
        </div>
      )}
    </div>
  )
}
