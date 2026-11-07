'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { diagnose, errorString, fmt, n, type Diagnosis, type Receipt, type Tone, type TxResult, type Verdict } from './diagnose'
import { FramesTable } from './ui/FramesTable'
import { Send } from './ui/Send'
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
// How each node handles what it admits, in the explorer's words.
const NODE_ROLE: Record<NodeId, string> = { gateway: 'manual bundling', miner: 'auto-bundles' }
const FEATURED = ['Ran out of gas', 'Validation gas over cap', 'Logic revert']

type View = 'inspect' | 'send' | 'live'
const viewFromHash = (): View => {
  const h = location.hash.replace('#', '')
  return h === 'send' || h === 'live' ? h : 'inspect'
}

const short = (h?: string | null) => (h ? `${h.slice(0, 6)}…${h.slice(-4)}` : 'none')
const ago = (ms?: number) => {
  if (!ms) return ''
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`
}
const toneOf = (o: string): Tone => (o === 'rejected' ? 'fail' : o === 'included' || o === 'accepted' ? 'pass' : 'warn')

export default function App() {
  const params = new URLSearchParams(location.search)
  // Own keys only: `in` would also accept inherited names such as ?node=constructor and crash the page.
  // With no ?node, open on the miner: sends go there, and the gateway's live list is mostly its own disk-full errors today.
  const [node, setNode] = useState<NodeId>(Object.hasOwn(NODES, params.get('node') ?? '') ? (params.get('node') as NodeId) : 'miner')
  const [input, setInput] = useState(params.get('tx') ?? '')
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [busy, setBusy] = useState(false)
  // Explorer-style tabs on the result. A new transaction always opens on Overview.
  const [tab, setTab] = useState<'overview' | 'frames' | 'checks'>('overview')
  useEffect(() => setTab('overview'), [loaded?.hash])
  // The page is three views, like an explorer's top nav: look up a transaction, send your own, watch the mempool.
  const [view, setView] = useState<View>(viewFromHash)
  const goView = (v: View) => {
    setView(v)
    history.replaceState(null, '', `${location.pathname}${location.search}${v === 'inspect' ? '' : `#${v}`}`)
    window.scrollTo({ top: 0 })
  }
  const [error, setError] = useState('')
  const [rows, setRows] = useState<AdmissionRow[] | null>(null)
  const [rowsError, setRowsError] = useState('')
  const [rowsBusy, setRowsBusy] = useState(false)
  const [filter, setFilter] = useState<'all' | 'rejected' | 'admitted'>('all')
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [filter, node])
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
    setRowsBusy(true)
    try {
      setRows((await recent(which, 200)).sort((a, b) => (b.at ?? 0) - (a.at ?? 0)))
    } catch (e) {
      setRows([])
      setRowsError(`Couldn't reach the ${NODES[which].label.toLowerCase()} node: ${(e as Error).message}. The real cases above work offline.`)
    } finally {
      setRowsBusy(false)
    }
  }
  useEffect(() => {
    // A different node: drop the old node's rows, so they never sit under the new node's heading while it loads.
    setRows(null)
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
    setView('inspect')
    if (!/^0x[0-9a-f]{64}$/.test(hash)) {
      setError('Enter a transaction hash: 0x followed by 64 hex characters.')
      setLoaded(null)
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
        setLoaded(null)
        history.replaceState(null, '', location.pathname)
        return
      }
      setLoaded({ hash, node: which, tx, receipt: rc.r, source: 'live', chainUnknown: rc.unknown })
      history.replaceState(null, '', `?tx=${hash}&node=${which}`)
    } catch (e) {
      if (me !== latest.current) return
      if (saved) return loadSample(saved)
      setError(`Couldn't reach the devnet: ${(e as Error).message}. Try a real case below, which works offline.`)
      setLoaded(null)
      history.replaceState(null, '', location.pathname)
    } finally {
      if (me === latest.current) setBusy(false)
    }
  }

  function loadSample(s: SampleData) {
    ++latest.current
    setBusy(false)
    setError('')
    setView('inspect')
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
  // An error under the search box should be seen, wherever the click came from.
  useEffect(() => {
    if (error) window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [error])

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
    if (loaded.chainUnknown)
      return `The ${node} node's verdict is below, but the chain couldn't be checked right now, so whether it landed (and whether anyone paid) is unknown. Try Inspect again.`
    const failed = receipt?.frameReceipts.map((f, i) => (f.status === '0x0' ? i : -1)).filter((i) => i >= 0) ?? []
    if (receipt?.status === '0x1')
      return adm === 'rejected'
        ? `The transaction landed on chain and every frame worked. The ${node} node rejected one copy of it, but another copy got in, through the other node or a resend. Nothing to fix.`
        : 'The transaction was accepted, landed on chain, and every frame worked. Nothing to fix.'
    if (receipt)
      return `The transaction landed on chain, but frame ${failed.join(', ')} failed, and the payer was still charged.${adm === 'rejected' ? ` The ${node} node had also rejected one copy of it.` : ''} See what to change below.`
    if (adm === 'rejected') return `The ${node} node rejected this transaction, so it never reached the chain and nobody paid. See what to change below.`
    if (adm === 'accepted') return `The ${node} node accepted this transaction. It is waiting to be included in a block.`
    return `The ${node} node has no admission record for this transaction, and it is not on chain.`
  })()
  // Three steps every transaction goes through, each with a clear yes / no, so the outcome reads at a glance.
  const journey: { name: string; tone: Tone; state: string }[] = (() => {
    if (!loaded) return []
    const adm = loaded.tx.admission?.outcome
    const failedFrames = receipt?.frameReceipts.map((f, i) => (f.status === '0x0' ? i : -1)).filter((i) => i >= 0) ?? []
    return [
      {
        name: 'Mempool',
        tone: adm === 'rejected' ? (receipt ? 'warn' : 'fail') : adm ? 'pass' : 'info',
        state: adm === 'rejected' ? (receipt ? 'Rejected this copy' : 'Rejected') : adm ? 'Admitted' : 'No record',
      },
      {
        name: 'Block',
        tone: receipt ? 'pass' : loaded.chainUnknown ? 'warn' : adm === 'rejected' ? 'fail' : 'info',
        state: receipt ? `Included, block ${fmt(n(receipt.blockNumber))}` : loaded.chainUnknown ? "Couldn't check" : adm === 'rejected' ? 'Never included' : 'Waiting',
      },
      {
        name: 'Frames',
        tone: !receipt ? 'info' : failedFrames.length ? 'fail' : 'pass',
        state: !receipt ? 'Did not run' : failedFrames.length ? `Frame ${failedFrames.join(', ')} failed` : `All ${receipt.frameReceipts.length} worked`,
      },
    ]
  })()
  const payer = receipt?.payer ?? loaded?.tx.entry?.payer
  const sender = loaded?.tx.entry?.sender ?? loaded?.tx.admission?.sender
  const fee = receipt ? (n(receipt.gasUsed) * n(receipt.effectiveGasPrice)) / 1e18 : 0

  // Live demand evidence: how often this node rejects transactions, from how many senders, and why (sidecar rule names).
  const stats = useMemo(() => {
    if (!rows?.length) return null
    // Node faults (the sidecar's own disk errors) say nothing about the transactions, so they are not counted.
    const rejected = rows.filter((r) => r.outcome === 'rejected' && !isNodeFault(r))
    const rules = new Map<string, number>()
    for (const r of rejected) for (const c of r.checks) if (c.verdict === 'fail') rules.set(c.rule, (rules.get(c.rule) ?? 0) + 1)
    const ats = rows.map((r) => r.at ?? 0).filter(Boolean)
    const hours = ats.length > 1 ? (Math.max(...ats) - Math.min(...ats)) / 3_600_000 : 0
    return {
      total: rows.length,
      rejected: rejected.length,
      nodeFaults: rows.filter(isNodeFault).length,
      senders: new Set(rejected.map((r) => r.sender).filter(Boolean)).size,
      span: hours >= 1 ? `${hours.toFixed(1)} hours` : `${Math.max(1, Math.round(hours * 60))} minutes`,
      top: [...rules].sort((a, b) => b[1] - a[1]).slice(0, 4),
    }
  }, [rows])

  type Check = NonNullable<TxResult['admission']>['checks'][number]
  const renderCheck = (c: Check, i: number) => (
                    <li key={i} className={c.verdict}>
                      <Dot tone={c.verdict === 'pass' ? 'pass' : c.verdict === 'fail' ? 'fail' : 'info'} />
                      <code>{c.rule}</code>
                      {c.frameIndex !== undefined && (
                        <span className="muted">
                          frame {c.frameIndex}, {c.entity}
                        </span>
                      )}
                      <span className={`check-state ${c.verdict}`}>{c.verdict === 'pass' ? 'Passed' : c.verdict === 'fail' ? 'Failed' : 'Not checked'}</span>
                      {c.detail && <span className="detail">{c.detail}</span>}
                    </li>
  )

  const matching = rows?.filter((r) => filter === 'all' || (filter === 'rejected') === (r.outcome === 'rejected')) ?? []
  const PAGE = 12
  const pages = Math.max(1, Math.ceil(matching.length / PAGE))
  const current = Math.min(page, pages - 1)
  const shown = matching.slice(current * PAGE, current * PAGE + PAGE)
  const counts = { all: rows?.length ?? 0, rejected: rows?.filter((r) => r.outcome === 'rejected').length ?? 0, admitted: rows?.filter((r) => r.outcome !== 'rejected').length ?? 0 }

  // Back to the start page: forget the loaded transaction.
  const home = () => {
    ++latest.current
    setLoaded(null)
    setInput('')
    setError('')
    setBusy(false)
    history.replaceState(null, '', location.pathname)
    setView('inspect')
    window.scrollTo({ top: 0 })
  }

  // The hash box. In the sticky header on every page but the start page, where it is the big one in the middle.
  const searchForm = (big: boolean) => (
    <form
      className={`searchbar${big ? ' big' : ''}`}
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        inspect(input, node)
      }}
    >
      <label htmlFor={big ? 'hash' : 'hash-top'} className="sr">
        Transaction hash
      </label>
      <div className="row">
        <svg className="mag" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <circle cx="9" cy="9" r="5.5" />
          <path d="m13.5 13.5 3.5 3.5" />
        </svg>
        <input
          id={big ? 'hash' : 'hash-top'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPaste={(e) => {
            // Pasting a whole hash is the common case: inspect it straight away.
            const pasted = e.clipboardData.getData('text').trim()
            if (/^0x[0-9a-fA-F]{64}$/.test(pasted)) {
              e.preventDefault()
              setInput(pasted)
              inspect(pasted, node)
            }
          }}
          placeholder={big ? 'Paste a transaction hash: 0x…' : 'Search by transaction hash'}
          spellCheck={false}
          autoComplete="off"
        />
        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Inspecting' : 'Inspect'}
        </button>
      </div>
    </form>
  )

  // One line of the live list. The same row shows on the start page (latest rejections) and on the Live mempool page.
  const renderRow = (r: AdmissionRow) => {
    const fail = r.checks.find((c) => c.verdict === 'fail')
    const fault = isNodeFault(r)
    return (
      <li key={`${r.txHash}-${r.at}`}>
        <button
          className="rowbtn"
          onClick={() => {
            setInput(r.txHash)
            inspect(r.txHash, r.node)
          }}
        >
          <Dot tone={fault ? 'warn' : toneOf(r.outcome)} />
          <code>{short(r.txHash)}</code>
          <span className={`r-out ${fault ? 'warn' : toneOf(r.outcome)}`}>{fault ? 'Node error' : r.outcome}</span>
          <span className="r-why" title={fail?.detail}>
            {fault ? 'Node disk full, not a problem with this transaction' : fail ? (fail.detail ?? fail.rule) : `${r.frames?.length ?? 0} frames`}
          </span>
          <span className="muted r-at">{ago(r.at)}</span>
        </button>
      </li>
    )
  }
  const latestRejections = rows?.filter((r) => r.outcome === 'rejected' && !isNodeFault(r)).slice(0, 6) ?? []
  const rejectedPct = stats ? Math.round((stats.rejected / stats.total) * 100) : null
  const showHero = view === 'inspect' && !loaded

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-in">
          <button type="button" className="brand-btn" onClick={home} aria-label="Readmit, back to the start">
            <svg className="mark" viewBox="0 0 256 256" aria-hidden="true" focusable="false">
              <defs>
                <linearGradient id="mark-fill" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#d9ccff" />
                  <stop offset="0.55" stopColor="#ad93ff" />
                  <stop offset="1" stopColor="#7b5ce6" />
                </linearGradient>
              </defs>
              <g fill="url(#mark-fill)">
                <path d="M80 24C160 28 212 92 224 176 198 142 168 118 140 104 116 92 104 80 96 60L80 24Z" />
                <path d="M32 80C120 80 180 136 216 204 178 176 150 160 112 150 80 142 56 148 48 128L32 80Z" />
                <path d="M24 168C100 144 164 174 208 224 148 200 112 196 72 212 48 222 40 208 24 168Z" />
              </g>
            </svg>
            <span className="brand-name">Readmit</span>
          </button>

          <nav className="nav" aria-label="Sections">
            <button type="button" aria-current={view === 'inspect' ? 'page' : undefined} onClick={() => goView('inspect')}>
              Inspect
            </button>
            <button type="button" aria-current={view === 'send' ? 'page' : undefined} onClick={() => goView('send')}>
              Send &amp; fix
            </button>
            <button type="button" aria-current={view === 'live' ? 'page' : undefined} onClick={() => goView('live')}>
              Live mempool
              {stats && stats.rejected > 0 && <span className="nav-n">{stats.rejected}</span>}
            </button>
          </nav>

          {!showHero && searchForm(false)}

          <div className="seg" role="group" aria-label="Mempool node">
            {(Object.keys(NODES) as NodeId[]).map((id) => (
              <button key={id} className={id === node ? 'on' : ''} aria-pressed={id === node} title={`Chain 1337, ${NODE_ROLE[id]}`} onClick={() => setNode(id)}>
                {NODES[id].label}
              </button>
            ))}
          </div>
          <HeaderWallet />
        </div>
      </header>

      <main className="page" id="main">
        {error && view === 'inspect' && (
          <p className="banner-error" role="alert">
            {error}
          </p>
        )}

        {/* ───────────── Inspect: start page ───────────── */}
        {showHero && (
          <>
            <section className="hero" aria-label="Look up a transaction">
              <h1>Find out which frame failed, why, and exactly what to change.</h1>
              <p className="lede">Paste a transaction hash from the alt-mempool devnet and see what the mempool and the chain made of it.</p>
              {searchForm(true)}
              <div className="samples-line" aria-label="Real cases from the devnet">
                <span>No hash to hand? Open a real case:</span>
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
            </section>

            <section className="cards" aria-label="What you can do here">
              <article className="hcard">
                <h2>Live mempool</h2>
                {stats ? (
                  <>
                    <p className="big">{rejectedPct}%</p>
                    <p>
                      of the last {stats.total} transactions on the {NODES[node].label.toLowerCase()} node were rejected, from {stats.senders} senders.
                      {stats.top[0] && (
                        <>
                          {' '}
                          Top rule: <code>{stats.top[0][0]}</code>.
                        </>
                      )}
                    </p>
                  </>
                ) : (
                  <p>{rowsError ? 'The node could not be reached.' : 'Loading…'}</p>
                )}
                <button type="button" className="go" onClick={() => goView('live')}>
                  Open the live mempool →
                </button>
              </article>
              <article className="hcard">
                <h2>Send &amp; fix</h2>
                <p>Send your own transaction with gas paid in tUSD. Every send is dry-run first, and if a frame would run out of gas, one click raises its limit and sends.</p>
                <button type="button" className="go" onClick={() => goView('send')}>
                  Open Send &amp; fix →
                </button>
              </article>
              <article className="hcard">
                <h2>Use it from code</h2>
                <p>The same engine is a TypeScript SDK: explain a hash, check a transaction before sending, and send it with automatic fixes.</p>
                <a className="go linkbtn" href="https://github.com/manjeetsharma0796/readmit-sdk#readme" target="_blank" rel="noreferrer">
                  @readmit/sdk on GitHub →
                </a>
              </article>
            </section>

            <section className="latest" aria-label="Latest rejections">
              <div className="section-head">
                <h2>Latest rejections on the {NODES[node].label.toLowerCase()} node</h2>
                <button type="button" className="linkish" onClick={() => goView('live')}>
                  View all →
                </button>
              </div>
              {rows === null ? (
                <p className="muted">Loading recent transactions…</p>
              ) : latestRejections.length === 0 ? (
                <p className="muted">{rowsError || 'No rejections in this node’s recent history.'}</p>
              ) : (
                <ul className="rows">{latestRejections.map(renderRow)}</ul>
              )}
            </section>
          </>
        )}

        {/* ───────────── Inspect: one transaction ───────────── */}
        {view === 'inspect' && loaded && dx && (
          <div className={`txpage${busy ? ' stale' : ''}`} aria-busy={busy}>
            <div className="txhead">
              <div className="txhead-main">
                <p className="eyebrow">Transaction</p>
                <h1 ref={resultRef} tabIndex={-1}>
                  <code>{short(loaded.hash)}</code>
                  <Copy text={loaded.hash} label="transaction hash" />
                </h1>
                <span className={`badge status-badge ${status.tone}`}>
                  <Dot tone={status.tone} />
                  {status.text}
                </span>
              </div>
              <div className="actions">
                <a href={EXPLORER(loaded.hash, loaded.node)} target="_blank" rel="noreferrer">
                  Open in explorer
                </a>
                <button onClick={download}>Download report</button>
              </div>
            </div>

            <p className={`summary lead ${status.tone}`}>{summary}</p>
            <p className="seen">
              As seen by the {NODES[loaded.node].label.toLowerCase()} node
              {loaded.source === 'sample' && <span className="saved-badge">Saved copy · recorded earlier on the devnet, not a live check</span>}
            </p>

            <ol className="journey" aria-label="Outcome at a glance">
              {journey.map((j) => (
                <li key={j.name} className={`step ${j.tone}`}>
                  <span className="step-text">
                    <span className="step-name">{j.name}</span>
                    <span className="step-state">{j.state}</span>
                  </span>
                </li>
              ))}
            </ol>

            <div className="txgrid">
              <div className="txmain">
                <div className="tabs" role="tablist" aria-label="Transaction sections">
                  {TABS.map(([id, label], i) => {
                    const count =
                      id === 'checks'
                        ? loaded.tx.admission
                          ? loaded.tx.admission.checks.filter((c) => c.verdict === 'fail').length || null
                          : null
                        : id === 'frames'
                          ? dx.frames.length
                          : null
                    const failed = (id === 'checks' && count !== null) || (id === 'frames' && journey[2]?.tone === 'fail')
                    return (
                      <button
                        key={id}
                        type="button"
                        role="tab"
                        id={`tab-${id}`}
                        aria-selected={tab === id}
                        aria-controls={`panel-${id}`}
                        tabIndex={tab === id ? 0 : -1}
                        className={`tab${tab === id ? ' on' : ''}`}
                        onClick={() => setTab(id)}
                        onKeyDown={(e) => {
                          if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
                          const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length][0]
                          setTab(next)
                          document.getElementById(`tab-${next}`)?.focus()
                        }}
                      >
                        {label}
                        {count !== null && <span className={`tab-count${failed ? ' fail' : ''}`}>{count}</span>}
                      </button>
                    )
                  })}
                </div>

                <div className="panel" role="tabpanel" id="panel-overview" aria-labelledby="tab-overview" hidden={tab !== 'overview'}>
                  <section className="change" aria-label="What to change">
                    <h2>{receipt?.status === '0x1' && loaded.tx.admission?.outcome === 'rejected' ? 'Why that one copy was rejected (no action needed)' : dx.findings.some((f) => f.fix) ? 'What to change' : 'Result'}</h2>
                    <ol className="findings">
                      {dx.findings.map((f, i) => (
                        <li key={i} className={`finding ${f.tone}`}>
                          <span className="f-num" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                          <div className="f-body">
                            <span className={`f-tag ${f.tone}`}>{TAG[f.tone]}</span>
                            <p className="f-title">{f.title}</p>
                            {f.fix && (
                              <div className="fix-box">
                                <span className="fix-label">Fix</span>
                                <p className="fix">{f.fix}</p>
                              </div>
                            )}
                            {f.patch?.kind === 'gas' && f.frame !== undefined && loaded.receipt?.frameReceipts[f.frame] && (
                              <p className="how">
                                How we got {fmt(f.patch.gas)}: frame {f.frame} used {fmt(n(loaded.receipt.frameReceipts[f.frame].gasUsed))} gas, plus 25% headroom, rounded up to
                                the next 1,000. It's an estimate with a margin, not an exact minimum.
                              </p>
                            )}
                            <p className="why">{f.why}</p>
                            {!f.fix && nodeIssue(f.why, loaded.node) && (
                              <div className="fix-box">
                                <span className="fix-label">What you can do</span>
                                <p className="fix">{nodeIssue(f.why, loaded.node)}</p>
                              </div>
                            )}
                            {f.selector && (
                              <p className="decoded">
                                {f.tone === 'fail' && f.title.includes('validation') ? 'Error' : 'Call'}: <code>{names.get(f.selector) ?? f.selector}</code>
                              </p>
                            )}
                          </div>
                        </li>
                      ))}
                    </ol>
                    {why && why.hash === loaded.hash && (
                      <p className={`replay ${why.state}`} aria-live="polite">
                        <span className="replay-label">Why it reverted</span>
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
                  <p className="nextstep">
                    Hit this on your own transaction?{' '}
                    <button type="button" className="linkish" onClick={() => goView('send')}>
                      Send &amp; fix dry-runs it first and applies the fix →
                    </button>
                  </p>
                </div>

                <div className="panel" role="tabpanel" id="panel-frames" aria-labelledby="tab-frames" hidden={tab !== 'frames'}>
                  <section className="frames-main" aria-label="Frames">
                    <h2>Frames</h2>
                    <FramesTable dx={dx} tx={loaded.tx} receipt={loaded.receipt} names={names} />
                  </section>
                </div>

                <div className="panel" role="tabpanel" id="panel-checks" aria-labelledby="tab-checks" hidden={tab !== 'checks'}>
                  {loaded.tx.admission ? (
                    <>
                      <p className="muted">{checkCounts(loaded.tx.admission.checks).line}</p>
                      {loaded.tx.admission.checks.some((c) => c.verdict === 'fail') && (
                        <ul>{loaded.tx.admission.checks.filter((c) => c.verdict === 'fail').map((c, i) => renderCheck(c, i))}</ul>
                      )}
                      <details className="passed">
                        <summary>{checkCounts(loaded.tx.admission.checks).more}</summary>
                        <ul>{loaded.tx.admission.checks.filter((c) => c.verdict !== 'fail').map((c, i) => renderCheck(c, i))}</ul>
                      </details>
                    </>
                  ) : (
                    <p className="muted">This node kept no admission report for this transaction.</p>
                  )}
                </div>
              </div>

              <aside className="rail" aria-label="Summary">
                <section className="rail-card">
                  <h2>Verdicts</h2>
                  <dl className="kv">
                    <VerdictRow label={`Mempool (${NODES[loaded.node].label.toLowerCase()})`} hint="Whether the alt-mempool sidecar admitted it, from its admission report." v={loaded.receipt && dx.mempool.headline === 'Rejected' ? { ...dx.mempool, headline: 'Rejected this copy' } : dx.mempool} />
                    <VerdictRow label="On chain" hint="What the receipt says happened when the block ran it." v={loaded.chainUnknown ? { tone: 'warn', headline: "Couldn't check", sub: 'The receipt lookup failed. Try again.' } : dx.chain} />
                    <VerdictRow label="ERC-8421 spec" hint="A partial check against the alt-mempool spec: validation budget and validation reverts." v={dx.spec} />
                  </dl>
                </section>
                <section className="rail-card">
                  <h2>Transaction</h2>
                  <dl className="kv">
                    <dt>
                      <Hint text="The unique id of this transaction. Click it to copy." />
                      Hash
                    </dt>
                    <dd>
                      <Copy text={loaded.hash} label="transaction hash">
                        <code className="hash">{loaded.hash}</code>
                      </Copy>
                    </dd>
                    <dt>
                      <Hint text="The block that included this transaction." />
                      Block
                    </dt>
                    <dd>{receipt ? fmt(n(receipt.blockNumber)) : <span className="muted">Not in a block</span>}</dd>
                    <dt>
                      <Hint text="The account the transaction acts for. Its validation frame approves it." />
                      Sender
                    </dt>
                    <dd>{sender ? <Copy text={sender} label="sender address"><code>{sender}</code></Copy> : <span className="muted">Unknown</span>}</dd>
                    <dt>
                      <Hint text="The account that paid for gas. With a paymaster, this is not the sender." />
                      Payer
                    </dt>
                    <dd>{payer ? <Copy text={payer} label="payer address"><code>{payer}</code></Copy> : <span className="muted">Unknown</span>}</dd>
                    <dt>
                      <Hint text="What the payer was charged: gas used times the effective gas price." />
                      Transaction fee
                    </dt>
                    <dd>
                      {receipt ? (
                        <>
                          {fee.toFixed(6)} ETH <span className="muted">({fmt(n(receipt.gasUsed))} gas)</span>
                        </>
                      ) : (
                        <span className="muted">{loaded.chainUnknown ? "Unknown (couldn't check the chain)" : 'Nothing charged'}</span>
                      )}
                    </dd>
                  </dl>
                  <details className="more">
                    <summary>More details</summary>
                    <dl className="kv">
                      <dt>Gas price</dt>
                      <dd>{receipt ? `${(n(receipt.effectiveGasPrice) / 1e9).toFixed(2)} gwei` : <span className="muted">n/a</span>}</dd>
                      <dt>Frames</dt>
                      <dd>{dx.frames.length}</dd>
                      <dt>Seen by</dt>
                      <dd>{NODES[loaded.node].label} node</dd>
                      <dt>Source</dt>
                      <dd>{loaded.source === 'live' ? 'Live from the node' : 'Saved copy of a real devnet case'}</dd>
                    </dl>
                  </details>
                </section>
              </aside>
            </div>
          </div>
        )}

        {/* ───────────── Send & fix ───────────── */}
        {view === 'send' && (
          <section id="send" aria-label="Send your own transaction">
            <div className="pagehead">
              <div>
                <h1>Send &amp; fix</h1>
                <p>Send tUSD with gas paid in tUSD. It uses the Demo account in the top right.</p>
              </div>
            </div>
            <div className="sendgrid">
              <div>
                <Send />
              </div>
              <aside className="rail" aria-label="How it works">
                <section className="rail-card">
                  <h2>How it works</h2>
                  <ol className="steps-list">
                    <li>
                      <span>
                        <strong>Dry run</strong>
                        <span>The node simulates it first. Nothing is broadcast.</span>
                      </span>
                    </li>
                    <li>
                      <span>
                        <strong>Fix</strong>
                        <span>If a frame would run out of gas, Fix &amp; send raises its limit by 25% and re-quotes the fee.</span>
                      </span>
                    </li>
                    <li>
                      <span>
                        <strong>Send</strong>
                        <span>It is signed with the Demo account and sent to the {NODES.miner.label.toLowerCase()} node, which bundles it.</span>
                      </span>
                    </li>
                    <li>
                      <span>
                        <strong>Follow</strong>
                        <span>Watch it go from sent to admitted to included, with a link to the explorer.</span>
                      </span>
                    </li>
                  </ol>
                </section>
                <section className="rail-card">
                  <h2>Want to see why one failed?</h2>
                  <p className="muted">Paste any hash in the search box to see which frame failed and what to change.</p>
                  <button type="button" onClick={() => goView('inspect')}>
                    Inspect a transaction →
                  </button>
                </section>
              </aside>
            </div>
          </section>
        )}

        {/* ───────────── Live mempool ───────────── */}
        {view === 'live' && (
          <section id="live" className="recent" aria-label="Recent admissions">
            <div className="pagehead">
              <div>
                <h1>Live mempool</h1>
                <p>The latest admission decisions from the {NODES[node].label.toLowerCase()} node. Click a row to see what happened.</p>
              </div>
              <div className="toolbar">
                <div className="seg filter" role="group" aria-label="Show">
                  {(['all', 'rejected', 'admitted'] as const).map((f) => (
                    <button key={f} type="button" className={filter === f ? 'on' : ''} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                      {f === 'all' ? 'All' : f === 'rejected' ? 'Rejected' : 'Admitted'} {rows !== null && !rowsError && <span className="seg-n">{counts[f]}</span>}
                    </button>
                  ))}
                </div>
                <button onClick={() => loadRecent(node)} disabled={rowsBusy}>
                  {rowsBusy ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>
            </div>
            {stats && (
              <div className="stats" aria-label="Rejections on this node">
                <div className="tile">
                  <span className="tile-label">Rejected</span>
                  <span className="tile-value">{Math.round((stats.rejected / stats.total) * 100)}%</span>
                  <span className="tile-sub">
                    {stats.rejected} of the last {stats.total}
                    {stats.nodeFaults > 0 && <>, plus {stats.nodeFaults} node disk errors</>}
                  </span>
                </div>
                <div className="tile">
                  <span className="tile-label">Senders affected</span>
                  <span className="tile-value">{stats.senders}</span>
                  <span className="tile-sub">accounts with a rejection</span>
                </div>
                <div className="tile">
                  <span className="tile-label">Time covered</span>
                  <span className="tile-value tile-value-sm">{stats.span}</span>
                  <span className="tile-sub">by the last {stats.total}</span>
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
              <p className="muted">No {filter === 'all' ? '' : `${filter} `}transactions in this node's recent history.</p>
            ) : (
              <ul className="rows">
                <li className="rows-head" aria-hidden="true">
                  <span />
                  <span>Transaction</span>
                  <span>Outcome</span>
                  <span>Reason</span>
                  <span>Age</span>
                </li>
                {shown.map(renderRow)}
              </ul>
            )}
            {matching.length > 0 && (
              <nav className="pager" aria-label="Pages">
                <span className="pager-range">
                  {current * PAGE + 1}–{current * PAGE + shown.length} of {matching.length}
                </span>
                <button type="button" className="pager-btn" aria-label="Previous page" disabled={current === 0} onClick={() => setPage(current - 1)}>
                  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 3.5 5.5 8l4.5 4.5" /></svg>
                </button>
                <span className="pager-page">
                  {current + 1} / {pages}
                </span>
                <button type="button" className="pager-btn" aria-label="Next page" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
                  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3.5 10.5 8 6 12.5" /></svg>
                </button>
              </nav>
            )}
          </section>
        )}

        <footer>
          <p>
            <strong>CROPS.</strong> A static site with no backend: your browser talks straight to the alt-mempool sidecar and ethrex. No trackers, and
            fonts are self-hosted. Demo keys stay in this browser and are for the devnet only. Every send is dry-run first.{' '}
            <a href="https://github.com/manjeetsharma0796/readmit" target="_blank" rel="noreferrer">
              Open source (MIT)
            </a>
            {' · '}
            <a href="https://github.com/manjeetsharma0796/readmit-sdk" target="_blank" rel="noreferrer">
              SDK
            </a>
            .
          </p>
          <p>The ERC-8421 spec row in Verdicts is a partial check: it covers the validation budget and validation reverts only.</p>
          <Endpoints />
        </footer>
      </main>
    </div>
  )
}

// One-click copy: the label says what was copied, and the button confirms for a moment.
function Copy({ text, label, children }: { text: string; label: string; children?: React.ReactNode }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      className={`copy${children ? ' copy-value' : ''}${done ? ' done' : ''}`}
      aria-label={done ? 'Copied' : `Copy ${label}`}
      title={done ? 'Copied' : `Copy ${label}`}
      onClick={() => {
        const ok = () => {
          setDone(true)
          setTimeout(() => setDone(false), 1200)
        }
        // Copy from a hidden text area first: it works inside the click even where the async clipboard API is blocked.
        const legacy = () => {
          const t = document.createElement('textarea')
          t.value = text
          t.setAttribute('readonly', '')
          t.style.position = 'fixed'
          t.style.opacity = '0'
          document.body.appendChild(t)
          t.select()
          const copied = document.execCommand('copy')
          t.remove()
          if (copied) ok()
          else navigator.clipboard?.writeText(text).then(ok, () => {})
        }
        try {
          legacy()
        } catch {
          navigator.clipboard?.writeText(text).then(ok, () => {})
        }
      }}
    >
      {children}
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        {done ? <path d="M3.5 8.5l3 3 6-7" /> : <><rect x="5.5" y="5.5" width="8" height="8" rx="2" /><path d="M10.5 3.5v-.5a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 3v5A1.5 1.5 0 0 0 4 9.5h.5" /></>}
      </svg>
      {children && <span className="copy-note" aria-hidden="true">{done ? 'Copied' : ''}</span>}
    </button>
  )
}

const TABS = [
  ['overview', 'Overview'],
  ['frames', 'Frames'],
  ['checks', 'Mempool checks'],
] as const

// A rejection caused by the node's own storage, not by the transaction.
function isNodeFault(r: { checks: { verdict: string; detail?: string }[] }) {
  return r.checks.some((c) => c.verdict === 'fail' && /no space left on device|^IO error/i.test(c.detail ?? ''))
}

// Admission rule counts that add up: failed, passed, and not checked (skipped).
function checkCounts(ck: { verdict: string }[]) {
  const fail = ck.filter((c) => c.verdict === 'fail').length
  const pass = ck.filter((c) => c.verdict === 'pass').length
  const skip = ck.length - fail - pass
  return {
    line: [fail ? `${fail} failed` : '', `${pass} passed`, skip ? `${skip} not checked` : ''].filter(Boolean).join(' · '),
    more: `Show the ${pass} passed${skip ? ` and ${skip} not checked` : ''}`,
  }
}

// Explorer-style help: a small (i) before a field label; hover or focus shows what the field means.
function Hint({ text }: { text: string }) {
  return (
    <span className="hint-i" tabIndex={0} role="img" aria-label={text} data-tip={text}>
      i
    </span>
  )
}

// Some rejections come from the node itself, not from the transaction. Say so, and what to do instead.
function nodeIssue(why: string, node: NodeId): string | null {
  const other = NODES[node === 'gateway' ? 'miner' : 'gateway'].label
  if (/no space left on device/i.test(why))
    return `The ${NODES[node].label.toLowerCase()} node's disk is full, so it turns away every transaction until it is cleared. Nothing is wrong with yours. Send to the ${other} node instead, or resend later.`
  if (/^IO error/i.test(why)) return `The ${NODES[node].label.toLowerCase()} node hit a storage error, not a problem with your transaction. Send to the ${other} node instead, or resend later.`
  return null
}

// The short tag on each finding card.
const TAG: Record<Tone, string> = { fail: 'Problem', warn: 'Heads-up', pass: 'All good', info: 'Note' }

function Dot({ tone }: { tone: Tone }) {
  return <span className={`dot ${tone}`} aria-hidden="true" />
}

// The engine's verdict words are terse; show them in plain words.
const PLAIN: Record<string, string> = {
  Executed: 'Included in a block, all frames worked',
  'Executed with a failure': 'Included in a block, but a frame failed',
  'Not on chain': 'Not in any block',
  'No conflict found': 'No spec problem found',
}

function VerdictRow({ label, hint, v }: { label: string; hint?: string; v: Verdict }) {
  return (
    <>
      <dt>
        {hint && <Hint text={hint} />}
        {label}
      </dt>
      <dd className={`v-row ${v.tone}`}>
        <Dot tone={v.tone} />
        <span>
          <strong>{PLAIN[v.headline] ?? v.headline}</strong> <span className="muted">· {v.sub}</span>
        </span>
      </dd>
    </>
  )
}
