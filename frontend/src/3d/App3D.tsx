import { useRef, useState, useEffect } from 'react'
import { VLAWorld3D } from './physics3d/VLAWorld3D'
import SimCanvas3D from './components/SimCanvas3D'
import ControlPanel3D from './components/ControlPanel3D'
import MetricsPanel3D from './components/MetricsPanel3D'
import { useVLARunner3D, Status } from './hooks/useVLARunner3D'
import type { CaptureImages } from './physics3d/types3d'

export default function App3D() {
  const worldRef   = useRef<VLAWorld3D | null>(null)
  const captureRef = useRef<() => CaptureImages>(() => ({ perspective: '', topdown: '' }))
  const [instruction, setInstruction] = useState('')
  const [claudeAvailable, setClaudeAvailable] = useState<boolean | null>(null)

  const { mode, setMode, status, log, metrics, isRunning, handleRun, handleStop, handleReset, handleRandomize } =
    useVLARunner3D(worldRef, captureRef, instruction)

  useEffect(() => {
    fetch('/api/health').then(r => r.json()).then(d => setClaudeAvailable(d.claude_available)).catch(() => {})
  }, [])

  const statusColor: Record<Status, string> = {
    idle: '#546e7a', thinking: '#f39c12', executing: '#3498db',
    success: '#2ecc71', error: '#e74c3c',
  }

  return (
    <div style={s.root}>
      <header style={s.header}>
        <h1 style={s.title}>VLA Pick&amp;Place 3D Simulator</h1>
        <span style={{ ...s.badge, background: statusColor[status] }}>{status.toUpperCase()}</span>
        <span style={{ ...s.badge, background: claudeAvailable ? '#1565c0' : '#546e7a', marginLeft: 4 }}>
          {claudeAvailable ? '🤖 Claude VLA' : '⚙ No API Key'}
        </span>
        <span style={{ ...s.badge, background: '#263238', marginLeft: 4, fontSize: 10 }}>
          Three.js + Rapier3D
        </span>
      </header>

      <div style={s.main}>
        <div style={s.left}>
          <SimCanvas3D worldRef={worldRef} captureRef={captureRef} />
          <ControlPanel3D
            mode={mode}
            instruction={instruction}
            isRunning={isRunning}
            onModeChange={setMode}
            onInstructionChange={setInstruction}
            onRun={handleRun}
            onStop={handleStop}
            onReset={handleReset}
            onRandomize={handleRandomize}
          />
        </div>

        <div style={s.right}>
          <MetricsPanel3D metrics={metrics} />

          <div style={s.logBox}>
            <div style={s.logTitle}>Log</div>
            <div style={s.logScroll} ref={el => { if (el) el.scrollTop = el.scrollHeight }}>
              {log.length === 0
                ? <div style={s.logEmpty}>No log yet</div>
                : log.map((line, i) => <div key={i} style={s.logLine}>{line}</div>)
              }
            </div>
          </div>

          <div style={s.refBox}>
            <div style={s.refTitle}>Action Space 3D</div>
            {['MOVE_TCP_TO(x, y, z)', 'SET_GRIP(width_m)', 'GRASP()', 'RELEASE()'].map(a => (
              <div key={a} style={s.refItem}>{a}</div>
            ))}
            <div style={{ ...s.refItem, color: '#546e7a', marginTop: 6, fontSize: 10 }}>
              Units: meters | Transit y=0.40 | Pick y=0.04
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  root:      { minHeight: '100vh', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 },
  header:    { display: 'flex', alignItems: 'center', gap: 12 },
  title:     { fontSize: 20, fontWeight: 700, color: '#64b5f6', letterSpacing: 1 },
  badge:     { fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 12, letterSpacing: 1, color: '#fff' },
  main:      { display: 'flex', gap: 16, alignItems: 'flex-start' },
  left:      { display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'stretch', width: 640, flexShrink: 0 },
  right:     { display: 'flex', flexDirection: 'column', gap: 10, minWidth: 220, flex: 1 },
  logBox:    { background: '#0f3460', border: '1px solid #1a4a7a', borderRadius: 8, padding: 12, flex: 1 },
  logTitle:  { fontSize: 11, fontWeight: 700, color: '#64b5f6', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 8 },
  logScroll: { maxHeight: 400, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 },
  logEmpty:  { color: '#546e7a', fontSize: 12 },
  logLine:   { fontSize: 11, color: '#b0bec5', fontFamily: 'monospace', lineHeight: 1.5 },
  refBox:    { background: '#0f3460', border: '1px solid #1a4a7a', borderRadius: 8, padding: 12 },
  refTitle:  { fontSize: 11, fontWeight: 700, color: '#64b5f6', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 8 },
  refItem:   { fontSize: 11, color: '#81d4fa', fontFamily: 'monospace', padding: '2px 0' },
}
