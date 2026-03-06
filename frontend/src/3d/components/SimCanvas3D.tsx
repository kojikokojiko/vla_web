import { useEffect, useRef, useState, useCallback } from 'react'
import { VLAWorld3D } from '../physics3d/VLAWorld3D'
import type { CaptureImages } from '../physics3d/types3d'

type CameraPreset = 'default' | 'top' | 'front' | 'side' | 'iso'

interface Props {
  worldRef: React.MutableRefObject<VLAWorld3D | null>
  captureRef: React.MutableRefObject<() => CaptureImages>
}

const PRESETS: { key: CameraPreset; label: string; title: string }[] = [
  { key: 'default', label: '◈', title: 'Default view'  },
  { key: 'top',     label: '⬆', title: 'Top-down'      },
  { key: 'front',   label: '⬛', title: 'Front view'    },
  { key: 'side',    label: '▷', title: 'Side view'     },
  { key: 'iso',     label: '⟁', title: 'Isometric'     },
]

const PIP_SIZE = 180  // px

export default function SimCanvas3D({ worldRef, captureRef }: Props) {
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const pipRef     = useRef<HTMLCanvasElement>(null)
  const pipTopRef  = useRef<HTMLCanvasElement>(null)
  const animRef    = useRef<number>(0)

  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState<string | null>(null)
  const [activePreset, setActivePreset] = useState<CameraPreset>('default')
  const [showPip, setShowPip]           = useState(false)

  const handlePreset = useCallback((preset: CameraPreset) => {
    worldRef.current?.setCameraPreset(preset)
    setActivePreset(preset)
  }, [worldRef])

  // Toggle PiP — attach/detach top-down preview canvas to VLAWorld3D
  const handleTogglePip = useCallback(() => {
    setShowPip(prev => {
      const next = !prev
      setTimeout(() => {
        worldRef.current?.setCaptureTopPreviewCanvas(next ? pipTopRef.current : null)
      }, 0)
      return next
    })
  }, [worldRef])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let cancelled = false

    VLAWorld3D.create(canvas).then(world => {
      if (cancelled) return
      worldRef.current = world
      captureRef.current = () => world.capture()
      setLoading(false)

      let lastTime = 0
      const loop = (time: number) => {
        const dt = time - lastTime
        lastTime = time
        world.step(dt || 16)
        animRef.current = requestAnimationFrame(loop)
      }
      animRef.current = requestAnimationFrame(loop)
    }).catch(e => {
      if (!cancelled) setError(String(e))
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(animRef.current)
    }
  }, [worldRef, captureRef])

  // Resize observer for main canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        worldRef.current?.resize(width, height)
      }
    })
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [worldRef])

  return (
    <div style={{ position: 'relative', width: 640, height: 480, flexShrink: 0 }}>
      {/* Main display canvas */}
      <canvas
        ref={canvasRef}
        style={{
          width: '100%', height: '100%',
          border: '2px solid #2c3e50', borderRadius: 8,
          display: 'block',
        }}
      />

      {/* Camera controls bar */}
      {!loading && !error && (
        <div style={camBar}>
          <span style={camLabel}>Cam</span>
          {PRESETS.map(p => (
            <button
              key={p.key}
              title={p.title}
              style={{ ...camBtn, ...(activePreset === p.key ? camBtnActive : {}) }}
              onClick={() => handlePreset(p.key)}
            >
              {p.label}
            </button>
          ))}
          <div style={camDivider} />
          <button
            title="Toggle Claude's view (fixed capture camera)"
            style={{ ...camBtn, ...(showPip ? camBtnActive : {}), fontSize: 11, width: 'auto', padding: '0 6px' }}
            onClick={handleTogglePip}
          >
            👁 VLA
          </button>
          <span style={camHint}>drag:orbit  scroll:zoom  right:pan</span>
        </div>
      )}

      {/* PiP: Claude's top-down view (what Claude actually sees) */}
      {!loading && !error && (
        <div style={{ ...pipContainer, display: showPip ? 'block' : 'none' }}>
          <div style={pipTitle}>Claude's view (top-down)</div>
          <canvas
            ref={pipTopRef}
            width={PIP_SIZE}
            height={PIP_SIZE}
            style={{ display: 'block', borderRadius: '0 0 6px 6px' }}
          />
        </div>
      )}

      {loading && !error && (
        <div style={overlay}>
          <div style={{ fontSize: 14, color: '#64b5f6' }}>Initializing Rapier WASM...</div>
        </div>
      )}

      {error && (
        <div style={{ ...overlay, background: 'rgba(231,76,60,0.85)' }}>
          <div style={{ fontSize: 12, fontFamily: 'monospace' }}>Error: {error}</div>
        </div>
      )}
    </div>
  )
}

const overlay: React.CSSProperties = {
  position: 'absolute', inset: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'rgba(13,27,42,0.85)',
  borderRadius: 8,
  color: '#fff',
}

const camBar: React.CSSProperties = {
  position: 'absolute', top: 8, right: 8,
  display: 'flex', alignItems: 'center', gap: 4,
  background: 'rgba(13,27,42,0.80)',
  borderRadius: 6,
  padding: '4px 8px',
  backdropFilter: 'blur(4px)',
}

const camLabel: React.CSSProperties = {
  fontSize: 10, color: '#546e7a', fontWeight: 700,
  textTransform: 'uppercase', letterSpacing: 1, marginRight: 2,
}

const camBtn: React.CSSProperties = {
  fontSize: 13, width: 26, height: 26, border: '1px solid #2d6a9f',
  borderRadius: 4, background: 'transparent', color: '#90caf9',
  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 0,
}

const camBtnActive: React.CSSProperties = {
  background: '#1565c0', borderColor: '#1565c0', color: '#fff',
}

const camDivider: React.CSSProperties = {
  width: 1, height: 18, background: '#2d6a9f', margin: '0 2px',
}

const camHint: React.CSSProperties = {
  fontSize: 9, color: '#37474f', marginLeft: 4, whiteSpace: 'nowrap',
}

const pipContainer: React.CSSProperties = {
  position: 'absolute', bottom: 12, right: 12,
  border: '2px solid #1565c0',
  borderRadius: 8,
  overflow: 'hidden',
  background: '#0d1b2a',
  boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
}

const pipTitle: React.CSSProperties = {
  fontSize: 9, fontWeight: 700, color: '#64b5f6',
  textTransform: 'uppercase', letterSpacing: 1,
  padding: '3px 8px',
  background: 'rgba(21,101,192,0.3)',
}

const pipSubTitle: React.CSSProperties = {
  fontSize: 8, color: '#90caf9', textAlign: 'center',
  padding: '2px 0', background: 'rgba(0,0,0,0.3)', width: '100%',
}
