import { useEffect, useState } from 'react'
import type { TelemetryEvent } from '../../types'

export function TerminalPanel({ events }: { events: TelemetryEvent[] }) {
  const [paused, setPaused] = useState(false)
  const [cleared, setCleared] = useState(false)
  const [snapshot, setSnapshot] = useState(events)
  useEffect(() => {
    if (!paused && !cleared) setSnapshot(events)
  }, [events, paused, cleared])
  const visible = cleared ? [] : snapshot
  return <section className="card-ops dash-card"><div className="drawer-head"><div><span className="mono-label">SYSTEM EVENT STREAM</span><h3 style={{ margin: '8px 0' }}>Telemetry log</h3></div><div className="inline-actions"><button className="small-button" onClick={() => setPaused((value) => !value)}>{paused ? 'Resume' : 'Pause'}</button><button className="small-button" onClick={() => setCleared(true)}>Clear</button></div></div>
    <div className="terminal">{visible.slice(-50).reverse().map((event, index) => <div className={`terminal-row ${event.level === 'CRITICAL' ? 'critical' : event.level === 'WARN' ? 'warn' : ''}`} key={`${event.timestamp}-${index}`}>[{event.timestamp ? new Date(event.timestamp).toLocaleTimeString() : '--:--:--'}] [{event.level ?? 'INFO'}] {event.message ?? event.type}</div>)}{(!visible.length || paused) && <div className="terminal-row">Stream {paused ? 'paused' : 'cleared'}.</div>}</div>
  </section>
}
