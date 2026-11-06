import { useState } from 'react'
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

const tag = (mode: number, flags: number) => mode === 1 ? ((flags & 1) !== 0 ? 'Pay gas' : 'Verify') : mode === 2 ? 'Call' : 'Default'

function FrameSequence({ dx, tx, receipt, names }: { dx: Diagnosis; tx: TxResult; receipt: Receipt | null; names: Map<string, string | null> }) {
  const initial = dx.frames.findIndex((_, i) => frameStatus(i, dx, tx, receipt).failed)
  const [selected, setSelected] = useState(initial >= 0 ? initial : 0)
  const index = Math.min(selected, dx.frames.length - 1)
  const frame = dx.frames[index]
  if (!frame) return <p className="muted">No frame data was recorded for this transaction.</p>
  const st = frameStatus(index, dx, tx, receipt)
  const rc = receipt?.frameReceipts[index]
  const limit = n(frame.limits.execution)
  const selector = frame.data.length >= 10 ? frame.data.slice(0, 10) : null
  const beforeFrames = !receipt && tx.admission?.outcome === 'rejected' && !dx.frames.some((_, i) => frameStatus(i, dx, tx, receipt).failed)
  return (
    <div className="frame-sequence">
      <div className="sequence-caption"><span>{dx.frames.length} frames in transaction order</span><span>Select a frame for details</span></div>
      {beforeFrames && <p className="sequence-rejection">Admission rejected. No failing frame was identified.</p>}
      <ol className="fragment-list">
        {dx.frames.map((f, i) => {
          const status = frameStatus(i, dx, tx, receipt)
          const r = receipt?.frameReceipts[i]
          return (
            <li key={i} className={`fragment ${status.failed ? 'broken' : ''} ${r?.status === '0x2' ? 'skipped' : ''} ${f.mode === 1 ? 'validation' : 'execution'}`}>
              <button type="button" className="fragment-piece" aria-pressed={index === i} onClick={() => setSelected(i)}>
                <span className="fragment-phase">{f.mode === 1 ? 'Validation' : 'Execution'}</span>
                <span className="fragment-name"><b>Frame {i}</b> {tag(f.mode, f.flags)}</span>
                <span className={`fragment-status ${status.failed ? 'failed' : r?.status === '0x1' ? 'ok' : ''}`}>{status.text}</span>
              </button>
            </li>
          )
        })}
      </ol>
      <section className={`frame-inspector ${st.failed ? 'is-failed' : ''}`} aria-label="Selected frame" aria-live="polite">
        <div className="frame-inspector-head"><strong>Frame {index}</strong><span>{role(frame)}</span><span className={`frame-state ${st.failed ? 'failed' : st.text === 'Succeeded' ? 'succeeded' : ''}`}>{st.text}</span></div>
        <dl className="frame-facts">
          <div><dt>Target</dt><dd><code>{frame.target ?? 'Sender'}</code></dd></div>
          <div><dt>Call</dt><dd><code>{selector ? (names.get(selector) ?? selector) : 'No call data'}</code></dd></div>
          <div><dt>Gas used / limit</dt><dd>{rc ? fmt(n(rc.gasUsed)) : 'Not recorded'} / {fmt(limit)}</dd></div>
        </dl>
      </section>
    </div>
  )
}

export function FramesTable({ dx, tx, receipt, names }: { dx: Diagnosis; tx: TxResult; receipt: Receipt | null; names: Map<string, string | null> }) {
  return (
    <>
    <FrameSequence key={`${tx.entry?.sender ?? ""}:${dx.frames.map((f) => `${f.target}:${f.data}:${f.limits.execution}`).join("|")}:${receipt?.blockNumber ?? tx.admission?.outcome ?? ""}`} dx={dx} tx={tx} receipt={receipt} names={names} />
    <details className="frame-table-details"><summary>Full frame table</summary>
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
              <tr key={i} className={`${f.mode === 1 ? 'verify' : 'op'} ${st.failed ? 'failed' : st.text === 'Succeeded' ? 'succeeded' : ''}`}>
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
    </details>
    </>
  )
}
