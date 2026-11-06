import { fmt, n, role, type Diagnosis, type Receipt, type TxResult } from '../diagnose'

const short = (h?: string | null) => (h ? `${h.slice(0, 6)}…${h.slice(-4)}` : 'none')

// Plain-words status for one frame, from the receipt when there is one, else from the admission report.
function frameStatus(i: number, dx: Diagnosis, tx: TxResult, receipt: Receipt | null): { text: string; failed: boolean } {
  const rc = receipt?.frameReceipts[i]
  const finding = dx.findings.find((x) => x.frame === i && x.tone === 'fail')
  if (rc) {
    if (rc.status === '0x1') return { text: 'Succeeded', failed: false }
    if (rc.status === '0x2') return { text: 'Skipped', failed: false }
    return { text: finding?.title.includes('ran out of gas') ? 'Ran out of gas' : 'Reverted', failed: true }
  }
  if (finding) return { text: finding.title.includes('ran out of gas') ? 'Ran out of gas' : 'Failed validation', failed: true }
  const s = tx.admission?.frameStatuses?.[i]
  return { text: !s || s === 'not-run' ? 'Not run' : s[0].toUpperCase() + s.slice(1), failed: false }
}

// Short label for a frame segment in the map.
const tag = (mode: number, flags: number) => (mode === 1 ? ((flags & 1) !== 0 ? 'Pay' : 'Verify') : mode === 2 ? 'Call' : 'Default')

/** The transaction as its pieces: one strip, split into validation and execution, each frame sized by its gas limit and filled to what it used. */
function FrameMap({ dx, tx, receipt }: { dx: Diagnosis; tx: TxResult; receipt: Receipt | null }) {
  const frames = dx.frames.map((f, i) => {
    const limit = n(f.limits.execution)
    const rc = receipt?.frameReceipts[i]
    const used = rc ? n(rc.gasUsed) : null
    const st = frameStatus(i, dx, tx, receipt)
    const state = st.failed ? 'bad' : rc?.status === '0x2' ? 'skip' : used === null ? 'idle' : 'ok'
    return { i, f, limit, used, st, state, pct: used !== null && limit ? Math.min(100, (used / limit) * 100) : 0 }
  })
  const zones = [
    { name: 'Validation', items: frames.filter((x) => x.f.mode === 1) },
    { name: 'Execution', items: frames.filter((x) => x.f.mode !== 1) },
  ].filter((z) => z.items.length)
  const total = frames.reduce((a, x) => a + Math.max(x.limit, 1), 0)
  return (
    <div className="framemap" role="img" aria-label={frames.map((x) => `frame ${x.i} ${x.st.text}`).join(', ')}>
      {zones.map((z) => (
        <div key={z.name} className="fm-zone" style={{ flexGrow: z.items.reduce((a, x) => a + Math.max(x.limit, 1), 0) / total }}>
          <span className="fm-zone-name">{z.name}</span>
          <div className="fm-row">
            {z.items.map((x) => (
              <div
                key={x.i}
                className={`fm-seg ${x.state}`}
                style={{ flexGrow: Math.max(x.limit, 1) }}
                title={`Frame ${x.i} · ${role(x.f)} · ${x.used !== null ? `${fmt(x.used)} of ${fmt(x.limit)} gas (${x.pct.toFixed(1)}%)` : `limit ${fmt(x.limit)}`} · ${x.st.text}`}
              >
                <span className="fm-fill" style={{ width: `${x.pct}%` }} />
                <span className="fm-label">
                  <b>{x.i}</b> {tag(x.f.mode, x.f.flags)}
                </span>
                <span className="fm-pct">{x.used !== null ? `${Math.round(x.pct)}%` : x.st.text}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export function FramesTable({ dx, tx, receipt, names }: { dx: Diagnosis; tx: TxResult; receipt: Receipt | null; names: Map<string, string | null> }) {
  return (
    <>
    <FrameMap dx={dx} tx={tx} receipt={receipt} />
    <div className="table-wrap">
      <table className="frames">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Role</th>
            <th scope="col">Target</th>
            <th scope="col">Call</th>
            <th scope="col">Gas used / limit</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {dx.frames.map((f, i) => {
            const rc = receipt?.frameReceipts[i]
            const limit = n(f.limits.execution)
            const used = rc ? n(rc.gasUsed) : null
            const pct = used !== null && limit ? Math.min(100, (used / limit) * 100) : 0
            const sel = f.data.length >= 10 ? f.data.slice(0, 10) : null
            const st = frameStatus(i, dx, tx, receipt)
            return (
              <tr key={i} className={`${f.mode === 1 ? 'verify' : 'op'} ${st.failed ? 'failed' : ''}`}>
                <td data-label="#" className="t-num">
                  {i}
                </td>
                <td data-label="Role">{role(f)}</td>
                <td data-label="Target">
                  <code title={f.target ?? undefined}>{f.target ? short(f.target) : 'sender'}</code>
                </td>
                <td data-label="Call">
                  <code>{sel ? (names.get(sel) ?? sel) : 'no data'}</code>
                  {n(f.value) > 0 && <span className="muted"> · {fmt(n(f.value))} wei</span>}
                </td>
                <td data-label="Gas used / limit" className="t-gas">
                  <span>{used !== null ? `${fmt(used)} / ${fmt(limit)}` : `– / ${fmt(limit)}`}</span>
                  <span className="bar" role="img" title={used !== null ? `${fmt(used)} of ${fmt(limit)} gas (${pct.toFixed(1)}%)` : `Not executed, limit ${fmt(limit)}`} aria-label={used !== null ? `${pct.toFixed(0)} percent of gas limit used` : 'Not executed'}>
                    <span style={{ width: `${used !== null ? Math.max(pct, 1.5) : 0}%` }} />
                  </span>
                </td>
                <td data-label="Status" className="t-status">
                  {st.text}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
    </>
  )
}
