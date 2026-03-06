import { Metrics } from '../physics3d/types3d'

interface Props { metrics: Metrics }

export default function MetricsPanel3D({ metrics }: Props) {
  const rows = [
    { label: 'Episodes',     value: `${metrics.totalEpisodes}` },
    { label: 'Success Rate', value: `${(metrics.successRate * 100).toFixed(1)}%` },
    { label: 'Avg Steps',    value: metrics.avgSteps.toFixed(1) },
    { label: 'Drops',        value: `${metrics.dropCount}` },
    { label: 'Collisions',   value: `${metrics.collisionCount}` },
  ]
  return (
    <div style={s.panel}>
      <div style={s.title}>Metrics</div>
      <table style={s.table}><tbody>
        {rows.map(r => (
          <tr key={r.label}>
            <td style={s.label}>{r.label}</td>
            <td style={s.value}>{r.value}</td>
          </tr>
        ))}
      </tbody></table>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  panel: { background: '#0f3460', border: '1px solid #1a4a7a', borderRadius: 8, padding: '12px 16px', minWidth: 180 },
  title: { fontSize: 12, fontWeight: 700, letterSpacing: 2, color: '#64b5f6', textTransform: 'uppercase', marginBottom: 10 },
  table: { width: '100%', borderCollapse: 'collapse' },
  label: { color: '#90a4ae', fontSize: 12, padding: '3px 0' },
  value: { color: '#e0e0e0', fontSize: 14, fontWeight: 600, textAlign: 'right', fontFamily: 'monospace' },
}
