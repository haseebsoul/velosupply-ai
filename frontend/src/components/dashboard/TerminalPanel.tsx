import { useEffect, useMemo, useState } from 'react'
import type { TelemetryEvent } from '../../types'

type LevelFilter = 'ALL' | 'INFO' | 'WARN' | 'CRITICAL'

export function TerminalPanel({ events }: { events: TelemetryEvent[] }) {
  const [paused, setPaused] = useState(false)
  const [snapshot, setSnapshot] = useState(events)
  const [clearAt, setClearAt] = useState(0)
  const [level, setLevel] = useState<LevelFilter>('ALL')

  useEffect(() => {
    if (!paused) setSnapshot(events.slice(-500))
  }, [events, paused])

  const visible = useMemo(() => snapshot
    .filter((event) => !event.timestamp || Date.parse(event.timestamp) >= clearAt)
    .filter((event) => level === 'ALL' || (event.level ?? 'INFO') === level)
    .slice(-500)
    .reverse(), [snapshot, clearAt, level])

  return <section className="card-ops dash-card">
    <div className="drawer-head">
      <div>
        <span className="mono-label">SYSTEM EVENT STREAM</span>
        <h3 style={{ margin: '8px 0' }}>Telemetry log</h3>
      </div>
      <div className="inline-actions">
        <label className="sr-only" htmlFor="terminal-level-filter">Filter telemetry level</label>
        <select id="terminal-level-filter" aria-label="Filter telemetry level" className="field" style={{ width: 116, padding: '7px 9px' }} value={level} onChange={(event) => setLevel(event.target.value as LevelFilter)}>
          <option value="ALL">All levels</option>
          <option value="INFO">Info</option>
          <option value="WARN">Warning</option>
          <option value="CRITICAL">Critical</option>
        </select>
        <button className="small-button" onClick={() => setPaused((value) => !value)}>{paused ? 'Resume' : 'Pause'}</button>
        <button className="small-button" onClick={() => { setClearAt(Date.now()); setPaused(false) }}>Clear</button>
      </div>
    </div>
    <div className="terminal" aria-live="polite">
      {visible.map((event, index) => <div className={`terminal-row ${event.level === 'CRITICAL' ? 'critical' : event.level === 'WARN' ? 'warn' : ''}`} key={`${event.timestamp ?? event.type}-${index}`}>
        [{event.timestamp ? new Date(event.timestamp).toLocaleTimeString() : '--:--:--'}] [{event.level ?? 'INFO'}] {event.message ?? event.type}
      </div>)}
      {!visible.length && <div className="terminal-row">No events match this view.</div>}
      {paused && <div className="terminal-row">Stream paused.</div>}
    </div>
  </section>
}
