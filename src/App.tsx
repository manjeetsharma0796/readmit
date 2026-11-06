'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { diagnose, errorString, fmt, n, type Diagnosis, type Receipt, type Tone, type TxResult, type Verdict } from './diagnose'
import { FramesTable } from './ui/FramesTable'
import { Send } from './ui/Send'
import { Wallet } from './ui/Wallet'
import { HeaderWallet } from './ui/Connect'
import { Endpoints } from './ui/Endpoints'
import { replay } from './engine/frames'
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

// chainUnknown: the receipt lookup failed, so we can't say whether it landed (never claim 'not on chain' then).
type Loaded = { hash: string; node: NodeId; tx: TxResult; receipt: Receipt | null; source: 'live' | 'sample'; chainUnknown?: boolean }
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
// One of each kind up front; the rest sit under "More examples".
const FEATURED = ['Ran out of gas', 'Validation gas over cap', 'Logic revert']

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

  // "Why did it revert?": for a live tx that failed on chain, re-simulate it on the block before it (T16) to get the
  // revert data. ethrex keeps state for ~128 blocks, so this only works for a few minutes after inclusion.
  type Why = { hash: string; state: 'loading' | 'found' | 'none' | 'gone' | 'error'; frame?: number; text?: string }
  const [why, setWhy] = useState<Why | null>(null)
  useEffect(() => {
    setWhy(null)
    if (!loaded || loaded.source !== 'live' || loaded.receipt?.status !== '0x0') return
    const hash = loaded.hash
    setWhy({ hash, state: 'loading' })
    replay(hash as `0x${string}`)
      .then(async (sim) => {
        if (!sim) return setWhy({ hash, state: 'gone' })
        const data = sim.revertData
        const failed = sim.frames?.findIndex((f) => !f.succeeded) ?? -1
        const frame = sim.failedFrameIndex ?? (failed >= 0 ? failed : undefined)
        const text = errorString(data)
        if (text) return setWhy({ hash, state: 'found', frame, text: `"${text}"` })
        if (data && data.length >= 10) {
          const sel = data.slice(0, 10)
          const name = (await lookupSelectors([sel])).get(sel)
          return setWhy({ hash, state: 'found', frame, text: name ? `${name} (custom error)` : `custom error ${sel}` })
        }
        setWhy({ hash, state: 'none', frame })
      })
      .catch(() => setWhy({ hash, state: 'error' }))
  }, [loaded])

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

  // Each inspection or sample load gets a number; a slower, older response never replaces a newer choice.
  const latest = useRef(0)

  async function inspect(raw: string, which: NodeId) {
    const hash = raw.trim().toLowerCase()
    const me = ++latest.current
    setError('')
    if (!/^0x[0-9a-f]{64}$/.test(hash)) {
      setError('Enter a transaction hash: 0x followed by 64 hex characters.')
      return
    }
    setBusy(true)
    // A real case we saved earlier: if the node has forgotten it (it keeps history in memory) or is unreachable, show the saved copy, labelled as saved.
    const saved = SAMPLES.find((s) => s.data.hash.toLowerCase() === hash)?.data
    try {
      const [tx, rc] = await Promise.all([
        getTx(which, hash).catch((e: Error) => {
          if (/not found/i.test(e.message)) return null
          throw e
        }),
        getReceipt(hash).then(
          (r) => ({ r, unknown: false }),
          () => ({ r: null, unknown: true }),
        ),
      ])
      if (me !== latest.current) return
      if (!tx || (!tx.admission && !tx.entry)) {
        if (saved) return loadSample(saved)
        setError(`The ${NODES[which].label.toLowerCase()} node has no record of this transaction. Try the other node. The node keeps history in memory, so older transactions are gone after a restart.`)
        return
      }
      setLoaded({ hash, node: which, tx, receipt: rc.r, source: 'live', chainUnknown: rc.unknown })
      history.replaceState(null, '', `?tx=${hash}&node=${which}`)
    } catch (e) {
      if (me !== latest.current) return
      if (saved) return loadSample(saved)
      setError(`Couldn't reach the devnet: ${(e as Error).message}. Try a real case below, which works offline.`)
    } finally {
      if (me === latest.current) setBusy(false)
    }
  }

  function loadSample(s: SampleData) {
    ++latest.current
    setBusy(false)
    setError('')
    setInput(s.hash)
    const which: NodeId = s.node === 'miner' ? 'miner' : 'gateway'
    setNode(which)
    setLoaded({ hash: s.hash, node: which, tx: s.tx as unknown as TxResult, receipt: (s.receipt ?? null) as Receipt | null, source: 'sample' })
    history.replaceState(null, '', `?tx=${s.hash}&node=${which}`)
  }

  // Bring a new result into view and move focus to it, so a click visibly does something (especially on phones).
  const resultRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (!loaded) return
    resultRef.current?.scrollIntoView({ block: 'start' })
    resultRef.current?.focus({ preventScroll: true })
  }, [loaded])

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
    : loaded.chainUnknown
      ? { tone: 'warn', text: "Couldn't check the chain" }
      : receipt
      ? receipt.status === '0x1'
        ? { tone: 'pass', text: 'Landed, all frames worked' }
        : { tone: 'fail', text: 'Landed, but a frame failed' }
      : loaded.tx.admission?.outcome === 'rejected'
        ? { tone: 'fail', text: 'Rejected, never reached the chain' }
        : loaded.tx.admission?.outcome === 'accepted'
          ? { tone: 'warn', text: 'Accepted, waiting for a block' }
          : { tone: dx?.mempool.tone ?? 'info', text: dx?.mempool.headline ?? 'Unknown' }
  // One plain sentence that reconciles the node's admission check with what happened on chain. They can disagree:
  // a node can reject one copy (a duplicate, or one sent to the other node) while another copy lands.
  const summary = ((): string => {
    if (!loaded || !dx) return ''
    const adm = loaded.tx.admission?.outcome
    const node = NODES[loaded.node].label.toLowerCase()
    const rules = (loaded.tx.admission?.checks ?? []).filter((c) => c.verdict === 'fail').map((c) => c.rule).join(', ')
    if (loaded.chainUnknown)
      return `The ${node} node's verdict is below, but the chain couldn't be checked right now, so whether it landed (and whether anyone paid) is unknown. Try Inspect again.`
    const failed = receipt?.frameReceipts.map((f, i) => (f.status === '0x0' ? i : -1)).filter((i) => i >= 0) ?? []
    if (receipt?.status === '0x1')
      return adm === 'rejected'
        ? `The transaction landed on chain and every frame worked. The ${node} node rejected one copy of it${rules ? ` (rule ${rules})` : ''}, but another copy got in, through the other node or a resend. Nothing to fix.`
        : 'The transaction was accepted, landed on chain, and every frame worked. Nothing to fix.'
    if (receipt)
      return `The transaction landed on chain, but frame ${failed.join(', ')} failed, and the payer was still charged.${adm === 'rejected' ? ` The ${node} node had also rejected one copy of it.` : ''} See what to change below.`
    if (adm === 'rejected') return `The ${node} node rejected this transaction${rules ? ` (rule ${rules})` : ''}, so it never reached the chain and nobody paid. See what to change below.`
    if (adm === 'accepted') return `The ${node} node accepted this transaction. It is waiting to be included in a block.`
    return `The ${node} node has no admission record for this transaction, and it is not on chain.`
  })()
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
    <main className="page" id="main">
      <header className="top">
        <div className="brand">
          <svg className="mark" viewBox="0 0 256 256" aria-hidden="true" focusable="false">
            {/* Embossed: a violet gradient lit from the top left, with a soft contact shadow. */}
            <defs>
              <linearGradient id="mark-fill" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#d9ccff" />
                <stop offset="0.55" stopColor="#ad93ff" />
                <stop offset="1" stopColor="#7b5ce6" />
              </linearGradient>
              <filter id="mark-emboss" x="-20%" y="-20%" width="140%" height="150%">
                <feGaussianBlur in="SourceAlpha" stdDeviation="4" result="blur" />
                <feSpecularLighting in="blur" surfaceScale="5" specularConstant="0.85" specularExponent="18" lightingColor="#ffffff" result="spec">
                  <fePointLight x="-80" y="-100" z="220" />
                </feSpecularLighting>
                <feComposite in="spec" in2="SourceAlpha" operator="in" result="shine" />
                <feComposite in="SourceGraphic" in2="shine" operator="arithmetic" k1="0" k2="1" k3="0.6" k4="0" result="lit" />
                <feOffset in="SourceAlpha" dx="3" dy="6" result="drop" />
                <feGaussianBlur in="drop" stdDeviation="4" result="dropBlur" />
                <feColorMatrix in="dropBlur" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.75 0" result="shadow" />
                <feMerge>
                  <feMergeNode in="shadow" />
                  <feMergeNode in="lit" />
                </feMerge>
              </filter>
            </defs>
            <g fill="url(#mark-fill)" filter="url(#mark-emboss)">
              <path d="M80 24C160 28 212 92 224 176 198 142 168 118 140 104 116 92 104 80 96 60L80 24Z" />
              <path d="M32 80C120 80 180 136 216 204 178 176 150 160 112 150 80 142 56 148 48 128L32 80Z" />
              <path d="M24 168C100 144 164 174 208 224 148 200 112 196 72 212 48 222 40 208 24 168Z" />
            </g>
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
        <HeaderWallet />
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
          <span className="samples-title">Try a real case:</span>
          <div className="sample-group">
            {SAMPLES.filter((x) => FEATURED.includes(x.label)).map((x) => (
              <button type="button" key={x.label} className="chip" onClick={() => loadSample(x.data)}>
                {x.label}
              </button>
            ))}
          </div>
          <details className="more-samples">
            <summary>More examples ({SAMPLES.length - FEATURED.length})</summary>
            {GROUPS.map((g) => (
              <div key={g} className="sample-group">
                <span className="sample-label">{g}</span>
                {SAMPLES.filter((x) => x.group === g && !FEATURED.includes(x.label)).map((x) => (
                  <button type="button" key={x.label} className="chip" onClick={() => loadSample(x.data)}>
                    {x.label}
                  </button>
                ))}
              </div>
            ))}
          </details>
        </div>
      </form>

      {loaded && dx && (
        <section className="result" aria-label="Result">
          <div className="result-head">
            <h2 ref={resultRef} tabIndex={-1}>What happened</h2>
            <div className="actions">
              {loaded.source === 'sample' && <span className="saved-badge">Saved copy · recorded earlier on the devnet, not a live check</span>}
              <a href={EXPLORER(loaded.hash, loaded.node)} target="_blank" rel="noreferrer">
                Open in explorer
              </a>
              <button onClick={download}>Download report</button>
            </div>
          </div>


          <p className={`summary ${status.tone}`}>{summary}</p>
          <div className="result-body">
            <div className="main-col">
          <section className="change" aria-label="What to change">
            <h2>{receipt?.status === '0x1' && loaded.tx.admission?.outcome === 'rejected' ? 'Why that one copy was rejected (no action needed)' : dx.findings.some((f) => f.fix) ? 'What to change' : 'Result'}</h2>
            <ol className="findings">
              {dx.findings.map((f, i) => (
                <li key={i} className={`finding ${f.tone}`}>
                  <div className="f-title">
                    <Dot tone={f.tone} />
                    {f.title}
                  </div>
                  {f.fix && <p className="fix">{f.fix}</p>}
                  {f.patch?.kind === 'gas' && f.frame !== undefined && loaded.receipt?.frameReceipts[f.frame] && (
                    <p className="how">
                      How we got {fmt(f.patch.gas)}: frame {f.frame} used {fmt(n(loaded.receipt.frameReceipts[f.frame].gasUsed))} gas, plus 25% headroom, rounded up to
                      the next 1,000. It's an estimate with a margin, not an exact minimum.
                    </p>
                  )}
                  <p className="why">{f.why}</p>
                  {f.selector && (
                    <p className="decoded">
                      {f.tone === 'fail' && f.title.includes('validation') ? 'Error' : 'Call'}: <code>{names.get(f.selector) ?? f.selector}</code>
                    </p>
                  )}
                </li>
              ))}
            </ol>
            {why && why.hash === loaded.hash && (
              <p className={`replay ${why.state}`} aria-live="polite">
                <strong>Why it reverted: </strong>
                {why.state === 'loading' && 'replaying it on the block before it…'}
                {why.state === 'found' && (
                  <>
                    {why.frame !== undefined ? `frame ${why.frame} reverted with ` : 'reverted with '}
                    <code>{why.text}</code>, from a replay on the block before it.
                  </>
                )}
                {why.state === 'none' &&
                  (why.frame !== undefined
                    ? `a replay on the block before it fails at frame ${why.frame} again, so the failure is reproducible, but the node returns no revert message for it.`
                    : 'a replay on the block before it returned no revert message.')}
                {why.state === 'gone' && 'too old to replay: the node keeps state for about 128 blocks (roughly 13 minutes).'}
                {why.state === 'error' && "couldn't replay it right now."}
              </p>
            )}
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
            </div>
            <aside className="side" aria-label="Transaction details">
              <h3>Transaction</h3>
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
                <span className="muted">{loaded.chainUnknown ? "Unknown (couldn't check the chain)" : 'Nothing charged'}</span>
              )}
            </dd>
            <VerdictRow label={`Admission check (${NODES[loaded.node].label.toLowerCase()} node)`} v={dx.mempool} />
            <VerdictRow label="On chain" v={loaded.chainUnknown ? { tone: 'warn', headline: "Couldn't check", sub: 'The receipt lookup failed. Try again.' } : dx.chain} />
            <VerdictRow label="ERC-8421 spec check" v={dx.spec} />
          </dl>
            </aside>
          </div>
        </section>
      )}

      <section className="flow" aria-label="Send your own transaction">
        <div className="flow-head">
          <h2>Send your own</h2>
          <p className="muted">A wallet with tUSD and 0 ETH. Every send is dry-run first. If a frame would run out of gas, Fix &amp; send raises its limit and sends; other problems are explained so you can fix them.</p>
        </div>
        <div className="flow-grid">
          <Wallet />
          <Send />
        </div>
      </section>

      <section className="recent" aria-label="Recent admissions">
        <div className="recent-head">
          <h2>Live from the {NODES[node].label.toLowerCase()} node</h2>
          <label className="toggle">
            <input type="checkbox" checked={onlyRejected} onChange={(e) => setOnlyRejected(e.target.checked)} /> Rejected only
          </label>
          <button onClick={() => loadRecent(node)}>Refresh</button>
        </div>
        {stats && (
          <div className="stats" aria-label="Rejections on this node">
            <div className="tile">
              <span className="tile-label">
                <span className="dot fail" aria-hidden="true" /> Rejected
              </span>
              <span className="tile-value">{Math.round((stats.rejected / stats.total) * 100)}%</span>
              <span className="tile-sub">
                {stats.rejected} of the last {stats.total}
              </span>
            </div>
            <div className="tile">
              <span className="tile-label">Senders hit</span>
              <span className="tile-value">{stats.senders}</span>
              <span className="tile-sub">distinct accounts</span>
            </div>
            <div className="tile">
              <span className="tile-label">Window</span>
              <span className="tile-value tile-value-sm">{stats.span}</span>
              <span className="tile-sub">of this node's memory</span>
            </div>
            {stats.top.length > 0 && (
              <div className="tile tile-rules">
                <span className="tile-label">Top rules</span>
                <ul>
                  {stats.top.map(([rule, count]) => (
                    <li key={rule}>
                      <code>{rule}</code>
                      <span className="rule-bar" aria-hidden="true">
                        <span style={{ width: `${(count / stats.top[0][1]) * 100}%` }} />
                      </span>
                      <span className="rule-n">{count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
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
    </main>
  )
}

function Dot({ tone }: { tone: Tone }) {
  return <span className={`dot ${tone}`} aria-hidden="true" />
}

// The engine's verdict words are terse; show them in plain words.
const PLAIN: Record<string, string> = {
  Executed: 'Included in a block, all frames worked',
  'Executed with a failure': 'Included in a block, but a frame failed',
  'Not on chain': 'Not in any block',
  Rejected: 'Rejected this copy',
  'No conflict found': 'No spec problem found',
}

function VerdictRow({ label, v }: { label: string; v: Verdict }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className="v-row">
        <Dot tone={v.tone} />
        <span>
          <strong>{PLAIN[v.headline] ?? v.headline}</strong> <span className="muted">· {v.sub}</span>
        </span>
      </dd>
    </>
  )
}
