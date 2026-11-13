import { useCallback, useEffect, useMemo, useState } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Activity, AlertTriangle, BookOpen, RefreshCw, ShieldAlert, Siren } from 'lucide-react'
import { api, errorMessage } from '../../lib/apiClient'

type Slo = { id: string; name: string; target: number; observed: number; totalEvents: number; badEvents: number; budgetRemaining: number; burnRate: number | string; budgetState: string; description: string }
type Service = { service: string; status: string; latencyMs: number | null; error: string | null; at: string | null }
type Sample = { at: string; rps: number; p95: number; p99: number; errorRate: number; wsClients: number; memMb: number; heapUsedPct: number; eventLoopLagMs: number; dbLatencyMs: number; orderThroughput: number }
type Alert = { id: string; rule: string; severity: string; value: unknown; threshold: unknown; status: string; message: string; firedAt: string }
type Incident = { id: string; code: string; title: string; severity: 'SEV1' | 'SEV2' | 'SEV3'; status: string; summary: string; timeline: Array<{ at: string; actorId: string | null; note: string }> }
type Runbook = { id: string; title: string; trigger: string; impact: string; steps: string[]; verify: string; checkedSteps: number[] }
type Dashboard = { slos: Slo[]; metrics: Sample; samples: Sample[]; services: { status: string; services: Service[] }; alerts: Alert[]; incidents: Incident[]; chaos: { mode: string; expiresAt: string | null; activatedAt: string | null }; runbooks: Runbook[] }

const chaosModes = [
  { mode: 'latency', label: 'Add 500ms latency' },
  { mode: 'errors', label: 'Inject 5% errors' },
  { mode: 'db_slow', label: 'Slow repository calls' },
  { mode: 'circuit', label: 'Open circuit breaker' },
  { mode: 'reset', label: 'Reset all effects' }
]

function pct(value: number) { return Math.round(value * 100) + '%' }
function badgeClass(status: string) {
  if (['up', 'normal', 'resolved', 'ok'].includes(status)) return 'status-pill'
  if (['degraded', 'warning', 'acknowledged'].includes(status)) return 'status-pill status-warning'
  return 'status-pill status-danger'
}

export function ReliabilityPage() {
  const [data, setData] = useState<Dashboard | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [incidentTitle, setIncidentTitle] = useState('')
  const [incidentSummary, setIncidentSummary] = useState('')
  const [incidentSeverity, setIncidentSeverity] = useState<'SEV1' | 'SEV2' | 'SEV3'>('SEV2')
  const [expandedIncident, setExpandedIncident] = useState<string | null>(null)
  const [note, setNote] = useState('')

  const refresh = useCallback(async () => {
    try {
      const response = await api.get<Dashboard>('/sre')
      setData(response.data)
      setError('')
    } catch (reason) { setError(errorMessage(reason)) }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 10_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const samples = useMemo(() => (data?.samples || []).slice(-120).map((sample) => ({
    ...sample,
    label: new Date(sample.at).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    errorPercent: sample.errorRate * 100
  })), [data?.samples])

  async function mutate(action: () => Promise<unknown>, success: string) {
    setBusy(true)
    try {
      await action()
      setNotice(success)
      setError('')
      await refresh()
    } catch (reason) { setError(errorMessage(reason)) }
    finally { setBusy(false) }
  }

  async function saveIncident(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await mutate(() => api.post('/sre/incidents', {
      title: incidentTitle, severity: incidentSeverity, status: 'open', summary: incidentSummary
    }), 'Incident created.')
    setIncidentTitle('')
    setIncidentSummary('')
  }

  async function updateRunbook(book: Runbook, step: number, checked: boolean) {
    const current = new Set(book.checkedSteps)
    if (checked) current.add(step)
    else current.delete(step)
    await mutate(() => api.put('/sre/runbooks/' + book.id + '/progress', { checkedSteps: Array.from(current) }), book.id + ' checklist saved.')
  }

  async function incidentNote(id: string) {
    if (!note.trim()) return
    await mutate(() => api.post('/sre/incidents/' + id + '/notes', { note: note.trim() }), 'Incident timeline updated.')
    setNote('')
  }

  if (!data && error) return <main className="dashboard-content">
    <h1 className="ops-heading">Reliability</h1>
    <p className="danger-text" role="alert">{error}</p>
    <button className="small-button" onClick={() => void refresh()}><RefreshCw size={14} /> Retry</button>
  </main>

  return <main className="dashboard-content">
    <div className="drawer-head">
      <div><span className="mono-label">SITE RELIABILITY ENGINEERING</span><h1 className="ops-heading">Reliability</h1><p className="ops-copy">Service objectives, error budgets, health, alerts and controlled failure testing.</p></div>
      <button className="small-button" disabled={busy} onClick={() => void refresh()}><RefreshCw size={14} /> Refresh</button>
    </div>
    {error && <div role="alert" className="danger-text" style={{ marginBottom: 12 }}>{error}</div>}
    {notice && <div role="status" className="success-text" style={{ marginBottom: 12 }}>{notice}</div>}

    {data && <>
      <section className="dash-grid">
        <article className="card-ops dash-card"><span className="mono-label">API P95 LATENCY</span><strong className="capacity-total">{Math.round(data.metrics.p95)}ms</strong><p className="ops-copy">Browse target under 150ms</p></article>
        <article className="card-ops dash-card"><span className="mono-label">API ERROR RATE</span><strong className="capacity-total">{pct(data.metrics.errorRate)}</strong><p className="ops-copy">Critical threshold above 1%</p></article>
        <article className="card-ops dash-card"><span className="mono-label">WEBSOCKET CLIENTS</span><strong className="capacity-total">{data.metrics.wsClients}</strong><p className="ops-copy">Ping round-trip monitored</p></article>
        <article className="card-ops dash-card"><span className="mono-label">HEAP MEMORY</span><strong className="capacity-total">{data.metrics.memMb} MB</strong><p className="ops-copy">{data.metrics.heapUsedPct.toFixed(1)}% of heap limit</p></article>
      </section>

      <section className="card-ops dash-card">
        <div className="drawer-head"><div><span className="mono-label">SERVICE LEVEL OBJECTIVES</span><h2>Six SLOs &amp; error budgets</h2></div><span className={badgeClass(data.services.status)}>{data.services.status.toUpperCase()}</span></div>
        <div className="dash-grid">
          {data.slos.map((slo) => <article className="card-ops dash-card" key={slo.id}>
            <div className="drawer-head"><span className="mono-label">{slo.id}</span><span className={badgeClass(slo.budgetState)}>{slo.budgetState}</span></div>
            <h3>{slo.name}</h3><strong className="capacity-total">{pct(slo.observed)}</strong>
            <p className="ops-copy">Target {pct(slo.target)} · {slo.badEvents}/{slo.totalEvents} bad events</p>
            <div className="capacity-meter-track"><span style={{ width: pct(slo.budgetRemaining), background: slo.budgetState === 'danger' ? 'var(--accent-ops-orange)' : undefined }} /></div>
            <p className="ops-copy">Budget remaining: {pct(slo.budgetRemaining)} · Burn rate: {String(slo.burnRate)}</p>
            <p className="ops-copy">{slo.description}</p>
          </article>)}
        </div>
        <p className="ops-copy">Budget above 50%: normal. 20–50%: freeze risky changes. Below 20% or burn rate above 14: danger.</p>
      </section>

      <section className="dash-two">
        <article className="card-ops dash-card">
          <span className="mono-label">TELEMETRY · LAST 120 TICKS</span><h2>Request volume &amp; latency</h2>
          <div style={{ height: 260 }}><ResponsiveContainer><AreaChart data={samples}>
            <CartesianGrid stroke="var(--border-ops)" vertical={false} /><XAxis dataKey="label" hide /><YAxis yAxisId="left" stroke="var(--text-ops-muted)" /><YAxis yAxisId="right" orientation="right" stroke="var(--text-ops-muted)" /><Tooltip />
            <Area yAxisId="left" type="monotone" dataKey="rps" name="Requests/sec" stroke="var(--accent-ops-lime)" fill="var(--accent-ops-lime)" fillOpacity={.12} />
            <Area yAxisId="right" type="monotone" dataKey="p95" name="p95 ms" stroke="var(--accent-ops-orange)" fill="var(--accent-ops-orange)" fillOpacity={.08} />
          </AreaChart></ResponsiveContainer></div>
        </article>
        <article className="card-ops dash-card">
          <span className="mono-label">ERROR RATE &amp; ORDER THROUGHPUT</span><h2>Request quality</h2>
          <div style={{ height: 260 }}><ResponsiveContainer><AreaChart data={samples}>
            <CartesianGrid stroke="var(--border-ops)" vertical={false} /><XAxis dataKey="label" hide /><YAxis stroke="var(--text-ops-muted)" /><Tooltip />
            <Area type="monotone" dataKey="errorPercent" name="Error rate %" stroke="var(--accent-ops-orange)" fill="var(--accent-ops-orange)" fillOpacity={.1} />
            <Area type="monotone" dataKey="orderThroughput" name="Checkout throughput" stroke="var(--accent-ops-lime)" fill="var(--accent-ops-lime)" fillOpacity={.1} />
          </AreaChart></ResponsiveContainer></div>
        </article>
      </section>

      <section className="card-ops dash-card">
        <div className="drawer-head"><div><span className="mono-label">HEALTH CHECKS · EVERY 10 SECONDS</span><h2>Five service probes</h2></div><span className={badgeClass(data.services.status)}>{data.services.status}</span></div>
        <div className="dash-grid">
          {data.services.services.map((service) => <article className="card-ops dash-card" key={service.service}>
            <div className="drawer-head"><strong>{service.service}</strong><span className={badgeClass(service.status)}>{service.status}</span></div>
            <p className="ops-copy">{service.latencyMs === null ? 'No sample yet' : service.latencyMs + 'ms'} · {service.at ? new Date(service.at).toLocaleTimeString() : 'Waiting'}</p>
            {service.error && <p className="danger-text">{service.error}</p>}
          </article>)}
        </div>
      </section>

      <section className="card-ops dash-card">
        <div className="drawer-head"><div><span className="mono-label">ALERT MANAGER</span><h2>Active alerts</h2></div><span className="status-pill">{data.alerts.filter((alert) => alert.status !== 'resolved').length} active</span></div>
        {data.alerts.filter((alert) => alert.status !== 'resolved').length === 0 && <p className="ops-copy">No active alerts.</p>}
        {data.alerts.filter((alert) => alert.status !== 'resolved').map((alert) => <div className="message-list-row" key={alert.id}>
          <AlertTriangle size={18} />
          <div style={{ flex: 1 }}><strong>{alert.rule}</strong><p className="ops-copy">{alert.message}</p><span className="mono-label">{alert.severity} · {new Date(alert.firedAt).toLocaleString()}</span></div>
          <span className={badgeClass(alert.status)}>{alert.status}</span>
          {alert.status === 'firing' && <button className="small-button" disabled={busy} onClick={() => void mutate(() => api.patch('/sre/alerts/' + alert.id + '/ack'), 'Alert acknowledged.')}>Acknowledge</button>}
          <button className="small-button" disabled={busy} onClick={() => void mutate(() => api.patch('/sre/alerts/' + alert.id + '/resolve'), 'Alert resolved.')}>Resolve</button>
        </div>)}
      </section>

      <section className="card-ops dash-card">
        <div className="drawer-head"><div><span className="mono-label">INCIDENT MANAGEMENT</span><h2>Incidents</h2></div><span className="status-pill">{data.incidents.length} open</span></div>
        <form className="dash-grid" onSubmit={saveIncident}>
          <label className="field-label">Title<input className="field" required minLength={3} maxLength={160} value={incidentTitle} onChange={(event) => setIncidentTitle(event.target.value)} /></label>
          <label className="field-label">Severity<select className="field" value={incidentSeverity} onChange={(event) => setIncidentSeverity(event.target.value as typeof incidentSeverity)}><option value="SEV1">SEV1 · 5 minutes</option><option value="SEV2">SEV2 · 30 minutes</option><option value="SEV3">SEV3 · Next working day</option></select></label>
          <label className="field-label">Summary<textarea className="field" rows={2} value={incidentSummary} onChange={(event) => setIncidentSummary(event.target.value)} /></label>
          <button className="small-button" disabled={busy || !incidentTitle.trim()} type="submit"><Siren size={14} /> Create incident</button>
        </form>
        {data.incidents.map((incident) => <article className="message-list-row" key={incident.id} style={{ alignItems: 'flex-start' }}>
          <ShieldAlert size={18} />
          <div style={{ flex: 1 }}>
            <div className="drawer-head"><strong>{incident.code} · {incident.title}</strong><span className={badgeClass(incident.severity === 'SEV1' ? 'danger' : incident.severity === 'SEV2' ? 'warning' : 'normal')}>{incident.severity}</span></div>
            <p className="ops-copy">{incident.summary}</p><span className="mono-label">Status: {incident.status}</span>
            {expandedIncident === incident.id && <div style={{ marginTop: 12 }}>
              {incident.timeline.map((entry, index) => <p className="ops-copy" key={entry.at + '-' + index}>{new Date(entry.at).toLocaleString()} · {entry.note}</p>)}
              <div className="ops-form-row"><input className="field" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add a timeline note" /><button className="small-button" disabled={busy || !note.trim()} onClick={() => void incidentNote(incident.id)}>Add note</button></div>
              <div className="inline-actions" style={{ marginTop: 8 }}>
                {['open', 'investigating', 'mitigated', 'resolved'].map((status) => <button key={status} className="small-button" disabled={busy || incident.status === status} onClick={() => void mutate(() => api.patch('/sre/incidents/' + incident.id, { status }), 'Incident marked ' + status + '.')}>{status}</button>)}
                <button className="small-button" disabled={busy} onClick={() => void mutate(() => api.delete('/sre/incidents/' + incident.id), 'Incident deleted.')}>Delete</button>
              </div>
            </div>}
          </div>
          <button className="small-button" onClick={() => setExpandedIncident((current) => current === incident.id ? null : incident.id)}>{expandedIncident === incident.id ? 'Close' : 'Details'}</button>
        </article>)}
      </section>

      <section className="card-ops dash-card">
        <div className="drawer-head"><div><span className="mono-label">CONTROLLED FAILURE TESTING</span><h2>Chaos controls</h2></div><span className={badgeClass(data.chaos.mode === 'reset' ? 'normal' : 'warning')}>{data.chaos.mode}</span></div>
        <p className="ops-copy">Experiments affect only product browsing and checkout. They never affect authentication, SRE endpoints or WebSocket telemetry. Every mode expires after 60 seconds.</p>
        <div className="inline-actions">{chaosModes.map((mode) => <button key={mode.mode} className="small-button" disabled={busy} onClick={() => void mutate(() => api.post('/sre/chaos', { mode: mode.mode }), mode.mode === 'reset' ? 'Chaos effects reset.' : 'Chaos mode ' + mode.mode + ' enabled for 60 seconds.')}>{mode.label}</button>)}</div>
        {data.chaos.expiresAt && <p className="ops-copy">Expires: {new Date(data.chaos.expiresAt).toLocaleTimeString()}</p>}
      </section>

      <section className="card-ops dash-card">
        <div className="drawer-head"><div><span className="mono-label">OPERATIONAL PLAYBOOKS</span><h2>Seven runbooks</h2></div><BookOpen size={19} /></div>
        {data.runbooks.map((book) => <details key={book.id} className="message-list-row">
          <summary><strong>{book.id} · {book.title}</strong><span className="ops-copy">Trigger: {book.trigger}</span></summary>
          <p className="ops-copy">{book.impact}</p>
          {book.steps.map((step, index) => <label key={index} className="message-list-row" style={{ alignItems: 'center' }}>
            <input type="checkbox" checked={book.checkedSteps.includes(index)} disabled={busy} onChange={(event) => void updateRunbook(book, index, event.target.checked)} />
            <span>{step}</span>
          </label>)}
          <p className="ops-copy"><Activity size={14} /> Verification: {book.verify}</p>
        </details>)}
      </section>
      <p className="ops-copy"><Activity size={14} /> Telemetry samples each second; this dashboard polls persisted SRE state every 10 seconds.</p>
    </>}
  </main>
}
