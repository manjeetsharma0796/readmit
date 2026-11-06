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

export function FramesTable({ dx, tx, receipt, names }: { dx: Diagnosis; tx: TxResult; receipt: Receipt | null; names: Map<string, string | null> }) {
  return (
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
  )
}
