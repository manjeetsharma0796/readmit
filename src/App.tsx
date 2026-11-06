import { useEffect, useMemo, useState } from 'react'
import { diagnose, fmt, n, role, type Diagnosis, type Receipt, type Tone, type TxResult, type Verdict } from './diagnose'
import { EXPLORER, NODES, getReceipt, getTx, lookupSelectors, recent, type AdmissionRow, type NodeId } from './rpc'
import oog from './samples/reverted-out-of-gas.json'
import cap from './samples/verify-gas-over-cap.json'
import sig from './samples/bad-signature.json'
import fee from './samples/replacement-fee-too-low.json'

type Loaded = { hash: string; node: NodeId; tx: TxResult; receipt: Receipt | null; source: 'live' | 'sample' }
const SAMPLES = [
  { label: 'Ran out of gas', data: oog },
  { label: 'Validation gas over cap', data: cap },
  { label: 'Bad signature', data: sig },
  { label: 'Replacement fee too low', data: fee },
] as const

const short = (h?: string | null) => (h ? `${h.slice(0, 6)}…${h.slice(-4)}` : 'none')
const ago = (ms?: number) => {
  if (!ms) return ''
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`
}
const toneOf = (o: string): Tone => (o === 'rejected' ? 'fail' : o === 'included' || o === 'accepted' ? 'pass' : 'warn')

export default function App() {
  const params = new URLSearchParams(location.search)
  const [node, setNode] = useState<NodeId>((params.get('node') as NodeId) in NODES ? (params.get('node') as NodeId) : 'gateway')
  const [input, setInput] = useState(params.get('tx') ?? '')
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [rows, setRows] = useState<AdmissionRow[] | null>(null)
  const [rowsError, setRowsError] = useState('')
  const [onlyRejected, setOnlyRejected] = useState(true)
  const [names, setNames] = useState<Map<string, string | null>>(new Map())

  const dx: Diagnosis | null = useMemo(() => (loaded ? diagnose(loaded.tx, loaded.receipt) : null), [loaded])

  useEffect(() => {
    if (!dx) return
    const sels = [...dx.frames.map((f) => f.data.slice(0, 10)), ...dx.findings.map((f) => f.selector ?? '')]
    lookupSelectors(sels).then((m) => setNames(new Map(m)))
  }, [dx])

  const loadRecent = async (which: NodeId) => {
    setRowsError('')
    try {
      setRows((await recent(which)).sort((a, b) => (b.at ?? 0) - (a.at ?? 0)))
    } catch (e) {
      setRows([])
      setRowsError(`Couldn't reach the ${NODES[which].label.toLowerCase()} node: ${(e as Error).message}. The real cases above work offline.`)
    }
  }
  useEffect(() => {
    loadRecent(node)
  }, [node])
  useEffect(() => {
    if (input) inspect(input, node)
    // run once for a shared ?tx= link
  }, [])

  async function inspect(raw: string, which: NodeId) {
    const hash = raw.trim().toLowerCase()
    setError('')
    if (!/^0x[0-9a-f]{64}$/.test(hash)) {
      setError('Enter a transaction hash: 0x followed by 64 hex characters.')
      return
    }
    setBusy(true)
    try {
      const [tx, receipt] = await Promise.all([getTx(which, hash), getReceipt(hash).catch(() => null)])
      if (!tx || (!tx.admission && !tx.entry)) {
        setError(`The ${NODES[which].label.toLowerCase()} node has no record of this transaction. Try the other node, or it may be older than the node's in-memory history.`)
        return
      }
      setLoaded({ hash, node: which, tx, receipt, source: 'live' })
      history.replaceState(null, '', `?tx=${hash}&node=${which}`)
    } catch (e) {
      setError(`Couldn't reach the devnet: ${(e as Error).message}. Try a real case below, which works offline.`)
    } finally {
      setBusy(false)
    }
  }

  function loadSample(s: (typeof SAMPLES)[number]['data']) {
    setError('')
    setInput(s.hash)
    setLoaded({ hash: s.hash, node: 'gateway', tx: s.tx as unknown as TxResult, receipt: s.receipt as unknown as Receipt | null, source: 'sample' })
  }

  function download() {
    if (!loaded || !dx) return
    const report = { tool: 'FrameLab prototype', chainId: 1337, hash: loaded.hash, node: loaded.node, source: loaded.source, exportedAt: new Date().toISOString(), verdicts: { mempool: dx.mempool, chain: dx.chain, spec: dx.spec }, findings: dx.findings, admission: loaded.tx.admission, receipt: loaded.receipt }
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }))
    a.download = `framelab-${loaded.hash.slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const shown = rows?.filter((r) => !onlyRejected || r.outcome === 'rejected').slice(0, 12) ?? []

  return (
    <div className="page">
      <header className="top">
        <div className="brand">
          <span className="mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <div>
            <h1>FrameLab</h1>
            <p className="tagline">Find out why a frame transaction was rejected, and what to change.</p>
          </div>
        </div>
        <div className="seg" role="group" aria-label="Mempool node">
          {(Object.keys(NODES) as NodeId[]).map((id) => (
            <button key={id} className={id === node ? 'on' : ''} aria-pressed={id === node} onClick={() => setNode(id)}>
              {NODES[id].label}
            </button>
          ))}
        </div>
      </header>

      <form
        className="search"
        onSubmit={(e) => {
          e.preventDefault()
          inspect(input, node)
        }}
      >
        <label htmlFor="hash">Transaction hash on the alt-mempool devnet (chain 1337)</label>
        <div className="row">
          <input id="hash" value={input} onChange={(e) => setInput(e.target.value)} placeholder="0x…" spellCheck={false} autoComplete="off" />
          <button type="submit" className="primary" disabled={busy}>
            {busy ? 'Inspecting' : 'Inspect'}
          </button>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="samples">
          <span>Real cases from the devnet:</span>
          {SAMPLES.map((s) => (
            <button type="button" key={s.label} className="chip" onClick={() => loadSample(s.data)}>
              {s.label}
            </button>
          ))}
        </div>
      </form>

      {loaded && dx && (
        <main className="result" aria-live="polite">
          <div className="result-head">
            <code className="hash">{loaded.hash}</code>
            <div className="actions">
              {loaded.source === 'sample' && <span className="note">Saved sample, not fetched live</span>}
              <a href={EXPLORER(loaded.hash, loaded.node)} target="_blank" rel="noreferrer">
                Open in explorer
              </a>
              <button onClick={download}>Download report</button>
            </div>
          </div>

          <section className="verdicts" aria-label="Three verdicts">
            <VerdictBox label={`Live mempool (${NODES[loaded.node].label.toLowerCase()})`} v={dx.mempool} />
            <VerdictBox label="On chain (ethrex)" v={dx.chain} />
            <VerdictBox label="ERC-8421 spec" v={dx.spec} />
          </section>

          <section aria-label="Diagnosis">
            <h2>What happened</h2>
            <ol className="findings">
              {dx.findings.map((f, i) => (
                <li key={i} className={`finding ${f.tone}`}>
                  <div className="f-title">
                    <Dot tone={f.tone} />
                    {f.title}
                  </div>
                  <p>{f.why}</p>
                  {f.selector && (
                    <p className="decoded">
                      {f.tone === 'fail' && f.title.includes('validation') ? 'Error' : 'Call'}: <code>{names.get(f.selector) ?? f.selector}</code>
                    </p>
                  )}
                  {f.fix && (
                    <p className="fix">
                      <strong>Fix:</strong> {f.fix}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </section>

          <section aria-label="Frames">
            <h2>Frames, in execution order</h2>
            <div className="strip">
              {dx.frames.map((f, i) => {
                const rc = loaded.receipt?.frameReceipts[i]
                const limit = n(f.limits.execution)
                const used = rc ? n(rc.gasUsed) : null
                const pct = used !== null && limit ? Math.min(100, (used / limit) * 100) : 0
                const failed = rc?.status === '0x0' || dx.findings.some((x) => x.frame === i && x.tone === 'fail')
                const sel = f.data.length >= 10 ? f.data.slice(0, 10) : null
                return (
                  <article key={i} className={`frame ${f.mode === 1 ? 'verify' : 'op'} ${failed ? 'failed' : ''}`}>
                    <div className="f-num">{i}</div>
                    <div className="f-role">{role(f)}</div>
                    <dl>
                      <dt>Target</dt>
                      <dd>
                        <code>{f.target ? short(f.target) : 'sender'}</code>
                      </dd>
                      <dt>Calls</dt>
                      <dd>
                        <code>{sel ? (names.get(sel) ?? sel) : 'no data'}</code>
                      </dd>
                      {n(f.value) > 0 && (
                        <>
                          <dt>Value</dt>
                          <dd>{fmt(n(f.value))} wei</dd>
                        </>
                      )}
                    </dl>
                    <div className="gas">
                      <div className="gas-label">
                        <span>Gas</span>
                        <span>{used !== null ? `${fmt(used)} / ${fmt(limit)}` : `limit ${fmt(limit)}`}</span>
                      </div>
                      <div className="bar" role="img" aria-label={used !== null ? `${pct.toFixed(0)} percent of gas limit used` : 'Not executed'}>
                        <span style={{ width: `${used !== null ? Math.max(pct, 1.5) : 0}%` }} />
                      </div>
                    </div>
                    <div className="f-status">{rc ? (rc.status === '0x1' ? 'Succeeded' : 'Failed') : (loaded.tx.admission?.frameStatuses?.[i] ?? '').replace('not-run', 'Not run') || 'Not run'}</div>
                  </article>
                )
              })}
            </div>
          </section>

          {loaded.tx.admission && (
            <details className="checks">
              <summary>Every admission rule the sidecar ran ({loaded.tx.admission.checks.length})</summary>
              <ul>
                {loaded.tx.admission.checks.map((c, i) => (
                  <li key={i} className={c.verdict}>
                    <Dot tone={c.verdict === 'pass' ? 'pass' : c.verdict === 'fail' ? 'fail' : 'info'} />
                    <code>{c.rule}</code>
                    {c.frameIndex !== undefined && <span className="muted">frame {c.frameIndex}, {c.entity}</span>}
                    <span className="muted">{c.verdict}</span>
                    {c.detail && <span className="detail">{c.detail}</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </main>
      )}

      <section className="recent" aria-label="Recent admissions">
        <div className="recent-head">
          <h2>Live from the {NODES[node].label.toLowerCase()} node</h2>
          <label className="toggle">
            <input type="checkbox" checked={onlyRejected} onChange={(e) => setOnlyRejected(e.target.checked)} /> Rejected only
          </label>
          <button onClick={() => loadRecent(node)}>Refresh</button>
        </div>
        {rowsError && <p className="error">{rowsError}</p>}
        {rows === null ? (
          <p className="muted">Loading recent transactions…</p>
        ) : shown.length === 0 && !rowsError ? (
          <p className="muted">No {onlyRejected ? 'rejected ' : ''}transactions in this node's recent history.</p>
        ) : (
          <ul className="rows">
            {shown.map((r) => {
              const fail = r.checks.find((c) => c.verdict === 'fail')
              return (
                <li key={`${r.txHash}-${r.at}`}>
                  <button
                    className="rowbtn"
                    onClick={() => {
                      setInput(r.txHash)
                      inspect(r.txHash, r.node)
                      window.scrollTo({ top: 0, behavior: 'smooth' })
                    }}
                  >
                    <Dot tone={toneOf(r.outcome)} />
                    <code>{short(r.txHash)}</code>
                    <span className="r-out">{r.outcome}</span>
                    <span className="r-why">{fail ? (fail.detail ?? fail.rule) : `${r.frames?.length ?? 0} frames`}</span>
                    <span className="muted r-at">{ago(r.at)}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <footer>
        Prototype. It reads the alt-mempool sidecar and ethrex directly from your browser, with no backend and no keys. The ERC-8421 column is a partial check that covers the validation budget and validation reverts only.
      </footer>
    </div>
  )
}

function Dot({ tone }: { tone: Tone }) {
  return <span className={`dot ${tone}`} aria-hidden="true" />
}

function VerdictBox({ label, v }: { label: string; v: Verdict }) {
  const word = { pass: 'Pass', fail: 'Fail', warn: 'Conditional', info: 'n/a' }[v.tone]
  return (
    <div className={`verdict ${v.tone}`}>
      <div className="v-label">{label}</div>
      <div className="v-head">
        <Dot tone={v.tone} />
        <span className="sr">{word}: </span>
        {v.headline}
      </div>
      <div className="v-sub">{v.sub}</div>
    </div>
  )
}
