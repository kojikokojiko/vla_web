import { EXAMPLES } from '../constants/examples'
import { Mode } from '../hooks/useVLARunner'

interface Props {
  mode: Mode
  instruction: string
  isRunning: boolean
  onModeChange: (mode: Mode) => void
  onInstructionChange: (instruction: string) => void
  onRun: () => void
  onStop: () => void
  onReset: () => void
  onRandomize: () => void
}

export default function ControlPanel({
  mode, instruction, isRunning,
  onModeChange, onInstructionChange,
  onRun, onStop, onReset, onRandomize,
}: Props) {
  return (
    <div style={s.box}>
      {/* ループモード */}
      <div style={s.modeRow}>
        <span style={s.modeLabel}>Loop:</span>
        {(['closed', 'open'] as Mode[]).map(m => (
          <button
            key={m}
            style={{ ...s.modeBtn, ...(mode === m ? s.modeBtnActive : {}) }}
            onClick={() => !isRunning && onModeChange(m)}
            disabled={isRunning}
          >
            {m === 'closed' ? '🔁 Closed-loop' : '⚡ Open-loop'}
          </button>
        ))}
      </div>

      {/* 例文 */}
      <div style={s.exSection}>
        {EXAMPLES.map(group => (
          <div key={group.label} style={s.exGroup}>
            <span style={s.exGroupLabel}>{group.label}</span>
            <div style={s.exRow}>
              {group.items.map(ex => (
                <button key={ex} style={s.exBtn} onClick={() => onInstructionChange(ex)}>{ex}</button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* 入力 */}
      <div style={s.inputRow}>
        <input
          style={s.input}
          value={instruction}
          onChange={e => onInstructionChange(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && e.ctrlKey && !isRunning && onRun()}
          placeholder="例: Pick up the red block and place it in Zone A"
          disabled={isRunning}
        />
        {isRunning
          ? <button style={{ ...s.btn, background: '#c0392b' }} onClick={onStop}>⏹ Stop</button>
          : <button style={s.btn} onClick={onRun} disabled={!instruction.trim()}>▶ Run</button>
        }
        <button style={{ ...s.btn, background: '#546e7a' }} onClick={onReset} disabled={isRunning}>↺ Reset</button>
        <button style={{ ...s.btn, background: '#4a235a' }} onClick={onRandomize} disabled={isRunning}>🎲 Rand</button>
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  box:          { background: '#0f3460', border: '1px solid #1a4a7a', borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 },
  modeRow:      { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  modeLabel:    { fontSize: 11, color: '#90a4ae', fontWeight: 600 },
  modeBtn:      { fontSize: 12, padding: '4px 12px', borderRadius: 6, border: '1px solid #2d6a9f', background: 'transparent', color: '#90caf9', cursor: 'pointer', fontWeight: 600 },
  modeBtnActive:{ background: '#1565c0', color: '#fff', borderColor: '#1565c0' },
  exSection:    { display: 'flex', flexDirection: 'column', gap: 4 },
  exGroup:      { display: 'flex', flexDirection: 'column', gap: 3 },
  exGroupLabel: { fontSize: 10, color: '#546e7a', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 },
  exRow:        { display: 'flex', gap: 6, flexWrap: 'wrap' },
  exBtn:        { fontSize: 11, background: '#1a4a7a', border: '1px solid #2d6a9f', borderRadius: 4, color: '#90caf9', padding: '3px 8px', cursor: 'pointer', whiteSpace: 'nowrap' },
  inputRow:     { display: 'flex', gap: 8 },
  input:        { flex: 1, background: '#16213e', border: '1px solid #2d6a9f', borderRadius: 6, color: '#e0e0e0', padding: '8px 12px', fontSize: 13 },
  btn:          { background: '#1565c0', border: 'none', borderRadius: 6, color: '#fff', padding: '8px 16px', fontSize: 13, cursor: 'pointer', fontWeight: 600 },
}
