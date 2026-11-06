'use client'

import { useEffect, useMemo, useState } from 'react'
import { diagnose, fmt, n, type Diagnosis, type Receipt, type Tone, type TxResult, type Verdict } from './diagnose'
import { FramesTable } from './ui/FramesTable'
import { Send } from './ui/Send'
import { Wallet } from './ui/Wallet'
import { Endpoints } from './ui/Endpoints'
import { EXPLORER, NODES, getReceipt, getTx, lookupSelectors, recent, type AdmissionRow, type NodeId } from './rpc'
import oog from './samples/reverted-out-of-gas.json'
import cap from './samples/verify-gas-over-cap.json'
import capV2 from './samples/verify-gas-budget-v2.json'
import sig from './samples/bad-signature.json'
import feeLow from './samples/replacement-fee-too-low.json'
import logic from './samples/logic-revert.json'
import payer from './samples/payer-cannot-pay.json'
import vOog from './samples/validation-oog.json'
import storage from './samples/unstaked-storage.json'
import opcode from './samples/banned-opcode.json'
import nonce from './samples/nonce-mismatch.json'
import paid from './samples/paid-in-tusd.json'

type Loaded = { hash: string; node: NodeId; tx: TxResult; receipt: Receipt | null; source: 'live' | 'sample' }
type SampleData = { hash: string; node?: string; tx: unknown; receipt?: unknown }
type Sample = { label: string; group: 'Rejected by the mempool' | 'Failed on chain' | 'Worked'; data: SampleData }
// Every saved real case from the devnet, grouped so the coverage is visible at a glance.
const SAMPLES: Sample[] = [
  { label: 'Validation gas over cap', group: 'Rejected by the mempool', data: cap },
  { label: 'Over cap (newer wording)', group: 'Rejected by the mempool', data: capV2 },
  { label: 'Validation ran out of gas', group: 'Rejected by the mempool', data: vOog },
  { label: 'Bad signature', group: 'Rejected by the mempool', data: sig },
  { label: "Payer can't cover cost", group: 'Rejected by the mempool', data: payer },
  { label: 'Unstaked storage read + opcode', group: 'Rejected by the mempool', data: storage },
  { label: 'Banned opcode', group: 'Rejected by the mempool', data: opcode },
  { label: 'Wrong nonce', group: 'Rejected by the mempool', data: nonce },
  { label: 'Replacement fee too low', group: 'Rejected by the mempool', data: feeLow },
  { label: 'Ran out of gas', group: 'Failed on chain', data: oog },
  { label: 'Logic revert', group: 'Failed on chain', data: logic },
  { label: 'Paid in tUSD, 0 ETH', group: 'Worked', data: paid },
]
const GROUPS = ['Rejected by the mempool', 'Failed on chain', 'Worked'] as const

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
      setRows((await recent(which, 200)).sort((a, b) => (b.at ?? 0) - (a.at ?? 0)))
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
    // A real case we saved earlier: if the node has forgotten it (it keeps history in memory) or is unreachable, show the saved copy, labelled as saved.
    const saved = SAMPLES.find((s) => s.data.hash.toLowerCase() === hash)?.data
    try {
      const [tx, receipt] = await Promise.all([
        getTx(which, hash).catch((e: Error) => {
          if (/not found/i.test(e.message)) return null
          throw e
        }),
        getReceipt(hash).catch(() => null),
      ])
      if (!tx || (!tx.admission && !tx.entry)) {
        if (saved) return loadSample(saved)
        setError(`The ${NODES[which].label.toLowerCase()} node has no record of this transaction. Try the other node. The node keeps history in memory, so older transactions are gone after a restart.`)
        return
      }
      setLoaded({ hash, node: which, tx, receipt, source: 'live' })
      history.replaceState(null, '', `?tx=${hash}&node=${which}`)
    } catch (e) {
      if (saved) return loadSample(saved)
      setError(`Couldn't reach the devnet: ${(e as Error).message}. Try a real case below, which works offline.`)
    } finally {
      setBusy(false)
    }
  }

  function loadSample(s: SampleData) {
    setError('')
    setInput(s.hash)
    setLoaded({ hash: s.hash, node: s.node === 'miner' ? 'miner' : 'gateway', tx: s.tx as unknown as TxResult, receipt: (s.receipt ?? null) as Receipt | null, source: 'sample' })
  }

  function download() {
    if (!loaded || !dx) return
    const report = { tool: 'Readmit', chainId: 1337, hash: loaded.hash, node: loaded.node, source: loaded.source, exportedAt: new Date().toISOString(), verdicts: { mempool: dx.mempool, chain: dx.chain, spec: dx.spec }, findings: dx.findings, admission: loaded.tx.admission, receipt: loaded.receipt }
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }))
    a.download = `readmit-${loaded.hash.slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const receipt = loaded?.receipt ?? null
  const status: { tone: Tone; text: string } = !loaded
    ? { tone: 'info', text: '' }
    : receipt
      ? receipt.status === '0x1'
        ? { tone: 'pass', text: 'Success' }
        : { tone: 'fail', text: 'Failed on chain' }
      : loaded.tx.admission?.outcome === 'rejected'
        ? { tone: 'fail', text: 'Rejected by the mempool' }
        : loaded.tx.admission?.outcome === 'accepted'
          ? { tone: 'warn', text: 'Admitted, pending' }
          : { tone: dx?.mempool.tone ?? 'info', text: dx?.mempool.headline ?? 'Unknown' }
  const payer = receipt?.payer ?? loaded?.tx.entry?.payer
  const sender = loaded?.tx.entry?.sender ?? loaded?.tx.admission?.sender
  const fee = receipt ? (n(receipt.gasUsed) * n(receipt.effectiveGasPrice)) / 1e18 : 0

  // Live demand evidence: how often this node rejects transactions, from how many senders, and why (sidecar rule names).
  const stats = useMemo(() => {
    if (!rows?.length) return null
    const rejected = rows.filter((r) => r.outcome === 'rejected')
    const rules = new Map<string, number>()
    for (const r of rejected) for (const c of r.checks) if (c.verdict === 'fail') rules.set(c.rule, (rules.get(c.rule) ?? 0) + 1)
    const ats = rows.map((r) => r.at ?? 0).filter(Boolean)
    const hours = ats.length > 1 ? (Math.max(...ats) - Math.min(...ats)) / 3_600_000 : 0
    return {
      total: rows.length,
      rejected: rejected.length,
      senders: new Set(rejected.map((r) => r.sender).filter(Boolean)).size,
      span: hours >= 1 ? `${hours.toFixed(1)} hours` : `${Math.max(1, Math.round(hours * 60))} minutes`,
      top: [...rules].sort((a, b) => b[1] - a[1]).slice(0, 4),
    }
  }, [rows])

  const shown = rows?.filter((r) => !onlyRejected || r.outcome === 'rejected').slice(0, 12) ?? []

  return (
    <div className="page">
      <header className="top">
        <div className="brand">
          <svg className="mark" viewBox="0 0 256 256" aria-hidden="true" focusable="false">
            <path d="M80 24C160 28 212 92 224 176 198 142 168 118 140 104 116 92 104 80 96 60L80 24Z" />
            <path d="M32 80C120 80 180 136 216 204 178 176 150 160 112 150 80 142 56 148 48 128L32 80Z" />
            <path d="M24 168C100 144 164 174 208 224 148 200 112 196 72 212 48 222 40 208 24 168Z" />
          </svg>
          <div>
            <h1>Readmit</h1>
            <p className="tagline">Find out which frame failed, why, and exactly what to change.</p>
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
        <div className="samples" aria-label="Real cases from the devnet">
          <span className="samples-title">Real cases from the devnet ({SAMPLES.length}):</span>
          {GROUPS.map((g) => (
            <div key={g} className="sample-group">
              <span className="sample-label">{g}</span>
              {SAMPLES.filter((s) => s.group === g).map((s) => (
                <button type="button" key={s.label} className="chip" onClick={() => loadSample(s.data)}>
                  {s.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      </form>

      {loaded && dx && (
        <main className="result" aria-live="polite">
          <div className="result-head">
            <h2>Transaction details</h2>
            <div className="actions">
              {loaded.source === 'sample' && <span className="note">Saved sample, not fetched live</span>}
              <a href={EXPLORER(loaded.hash, loaded.node)} target="_blank" rel="noreferrer">
                Open in explorer
              </a>
              <button onClick={download}>Download report</button>
            </div>
          </div>

          <dl className="overview">
            <dt>Transaction hash</dt>
            <dd>
              <code className="hash">{loaded.hash}</code>
            </dd>
            <dt>Status</dt>
            <dd>
              <span className={`badge ${status.tone}`}>
                <Dot tone={status.tone} />
                {status.text}
              </span>
            </dd>
            <dt>Block</dt>
            <dd>{loaded.receipt ? fmt(n(loaded.receipt.blockNumber)) : <span className="muted">Not in a block</span>}</dd>
            <dt>Sender</dt>
            <dd>{sender ? <code>{sender}</code> : <span className="muted">Unknown</span>}</dd>
            <dt>Payer</dt>
            <dd>{payer ? <code>{payer}</code> : <span className="muted">Unknown</span>}</dd>
            <dt>Fee</dt>
            <dd>
              {loaded.receipt ? (
                <>
                  {fee.toFixed(6)} ETH <span className="muted">({fmt(n(loaded.receipt.gasUsed))} gas)</span>
                </>
              ) : (
                <span className="muted">Nothing charged</span>
              )}
            </dd>
            <VerdictRow label={`Mempool (${NODES[loaded.node].label.toLowerCase()})`} v={dx.mempool} />
            <VerdictRow label="On chain (ethrex)" v={dx.chain} />
            <VerdictRow label="ERC-8421 spec" v={dx.spec} />
          </dl>

          <section className="change" aria-label="What to change">
            <h2>{dx.findings.some((f) => f.fix) ? 'What to change' : 'Result'}</h2>
            <ol className="findings">
              {dx.findings.map((f, i) => (
                <li key={i} className={`finding ${f.tone}`}>
                  <div className="f-title">
                    <Dot tone={f.tone} />
                    {f.title}
                  </div>
                  {f.fix && <p className="fix">{f.fix}</p>}
                  <p className="why">{f.why}</p>
                  {f.selector && (
                    <p className="decoded">
                      {f.tone === 'fail' && f.title.includes('validation') ? 'Error' : 'Call'}: <code>{names.get(f.selector) ?? f.selector}</code>
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </section>

          <section aria-label="Frames">
            <h2>Frames, in execution order</h2>
            <FramesTable dx={dx} tx={loaded.tx} receipt={loaded.receipt} names={names} />
          </section>

          <details className="checks">
            <summary>Technical details</summary>
            {loaded.tx.admission ? (
              <>
                <h3>Every admission rule the sidecar ran ({loaded.tx.admission.checks.length})</h3>
                <ul>
                  {loaded.tx.admission.checks.map((c, i) => (
                    <li key={i} className={c.verdict}>
                      <Dot tone={c.verdict === 'pass' ? 'pass' : c.verdict === 'fail' ? 'fail' : 'info'} />
                      <code>{c.rule}</code>
                      {c.frameIndex !== undefined && (
                        <span className="muted">
                          frame {c.frameIndex}, {c.entity}
                        </span>
                      )}
                      <span className="muted">{c.verdict}</span>
                      {c.detail && <span className="detail">{c.detail}</span>}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="muted">This node kept no admission report for this transaction.</p>
            )}
          </details>
        </main>
      )}

      <Wallet />
      <Send />

      <section className="recent" aria-label="Recent admissions">
        <div className="recent-head">
          <h2>Live from the {NODES[node].label.toLowerCase()} node</h2>
          <label className="toggle">
            <input type="checkbox" checked={onlyRejected} onChange={(e) => setOnlyRejected(e.target.checked)} /> Rejected only
          </label>
          <button onClick={() => loadRecent(node)}>Refresh</button>
        </div>
        {stats && (
          <p className="stats">
            <strong>
              {stats.rejected} of the last {stats.total}
            </strong>{' '}
            transactions this node saw were rejected
            {stats.senders > 0 && (
              <>
                , from <strong>{stats.senders}</strong> different {stats.senders === 1 ? 'sender' : 'senders'}
              </>
            )}
            , over {stats.span}.
            {stats.top.length > 0 && (
              <>
                {' '}
                Top rules:{' '}
                {stats.top.map(([rule, count], i) => (
                  <span key={rule}>
                    {i > 0 && ', '}
                    <code>{rule}</code> ×{count}
                  </span>
                ))}
                .
              </>
            )}
          </p>
        )}
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
        <p>
          <strong>CROPS.</strong> A static site with no backend: your browser talks straight to the alt-mempool sidecar and ethrex. No trackers, and
          fonts are self-hosted. Demo keys stay in this browser and are for the devnet only. Every send is dry-run first.{' '}
          <a href="https://github.com/manjeetsharma0796/readmit" target="_blank" rel="noreferrer">
            Open source (MIT)
          </a>
          .
        </p>
        <p>The ERC-8421 column is a partial check that covers the validation budget and validation reverts only.</p>
        <Endpoints />
      </footer>
    </div>
  )
}

function Dot({ tone }: { tone: Tone }) {
  return <span className={`dot ${tone}`} aria-hidden="true" />
}

function VerdictRow({ label, v }: { label: string; v: Verdict }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className="v-row">
        <Dot tone={v.tone} />
        <span>
          <strong>{v.headline}</strong> <span className="muted">· {v.sub}</span>
        </span>
      </dd>
    </>
  )
}
