import { useState } from 'react'
import App3D from './3d/App3D'
import App2D from './2d/App2D'

type Tab = '3d' | '2d'

export default function AppRoot() {
  const [tab, setTab] = useState<Tab>('3d')

  return (
    <div style={{ minHeight: '100vh', background: '#0a1628', color: '#e0e0e0', fontFamily: 'monospace' }}>
      <nav style={s.nav}>
        <TabBtn label="3D Simulator" active={tab === '3d'} onClick={() => setTab('3d')} />
        <TabBtn label="2D Simulator" active={tab === '2d'} onClick={() => setTab('2d')} />
      </nav>
      <div style={tab === '3d' ? undefined : s.hidden}><App3D /></div>
      <div style={tab === '2d' ? undefined : s.hidden}><App2D /></div>
    </div>
  )
}

function TabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ ...s.tab, ...(active ? s.tabActive : {}) }}>
      {label}
    </button>
  )
}

const s: Record<string, React.CSSProperties> = {
  nav:       { display: 'flex', gap: 4, padding: '8px 20px 0', borderBottom: '1px solid #1a4a7a', background: '#0a1628' },
  tab:       { padding: '6px 18px', fontSize: 12, fontWeight: 700, letterSpacing: 1, border: 'none', borderRadius: '6px 6px 0 0', cursor: 'pointer', background: '#1a3a5c', color: '#546e7a', fontFamily: 'monospace' },
  tabActive: { background: '#0f3460', color: '#64b5f6', borderBottom: '2px solid #64b5f6' },
  hidden:    { display: 'none' },
}
