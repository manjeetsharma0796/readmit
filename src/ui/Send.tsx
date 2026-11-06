import { useEffect, useRef, useState } from 'react'
import { formatUnits, isAddress, parseUnits, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { diagnose, diagnoseDraft, type Diagnosis, type Finding, type Patch, type Verdict } from '../diagnose'
import { applyPatch, buildSendTx, draftFrames, requote, signDraft, type Draft } from '../engine/frames'
import { EXPLORER, getReceipt, getTx, sendFrameTx, simulate, watchTx, type Stage } from '../rpc'
import { DEPLOY } from './deploy'
import { FixAndSend } from './FixAndSend'
import { loadKey } from './Wallet'

const STEPS = ['Checking (dry run)', 'Signing', 'Sent', 'Admitted', 'Included'] as const
type Step = 0 | 1 | 2 | 3 | 4 | 5 // index of the step in progress; 5 = all done
type Problem = { title: string; next: string; findings?: Finding[] }
type Fix = { finding: Finding & { patch: Patch }; oldHash: string | null; newHash: string | null }

// Demo only: a last-frame limit below what a tUSD transfer needs, so the dry run (or the chain) reports out of gas.
// A transfer to an existing holder uses 18,461 gas, so 20,000 was not low. 16,000 fails, and Readmit's own patch (×1.25 = 20,000)
// passes in one fix (checked with read-only dry runs, Sat 00:20).
const LOW_GAS = 16_000n
const ADDRS = { tUSD: DEPLOY.tUSD, paymaster: DEPLOY.paymaster }

// The fee frame is `tUSD.transfer(paymaster, fee)`: the amount is the last 32 bytes of its calldata.
const feeOf = (d: Draft) => BigInt(`0x${d.frames[2].data.slice(-64)}`)
const fixable = (fs: Finding[]) => fs.find((f): f is Finding & { patch: Patch } => f.tone === 'fail' && f.patch?.kind === 'gas')

export function Send() {
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [lowGas, setLowGas] = useState(false)
  const [step, setStep] = useState<Step | null>(null)
  const [hash, setHash] = useState<Hex | null>(null)
  const [fee, setFee] = useState<bigint | null>(null)
  const [problem, setProblem] = useState<Problem | null>(null)
  const [fix, setFix] = useState<Fix | null>(null)
  const [check, setCheck] = useState<Diagnosis | null>(null) // the latest dry run, shown even when it lets the send go ahead
  const [caught, setCaught] = useState<Draft | null>(null) // a low-gas draft the dry run stopped, for "Send anyway"
  const stop = useRef<() => void>(() => {})
  useEffect(() => () => stop.current(), [])

  const busy = step !== null && step < 5 && !problem

  function reset() {
    stop.current()
    setProblem(null)
    setHash(null)
    setFee(null)
    setCheck(null)
    setCaught(null)
  }

  /** Validates the form and returns what a send needs, or shows why it can't. */
  function inputs(): { key: Hex; to: Address; value: bigint } | null {
    const key = loadKey()
    if (!key) {
      setProblem({ title: 'No key imported', next: 'Import the demo key in the wallet panel first.' })
      return null
    }
    if (!isAddress(to.trim())) {
      setProblem({ title: 'That recipient is not an address', next: 'Enter 0x followed by 40 hex characters.' })
      return null
    }
    let value = 0n
    try {
      value = parseUnits(amount.trim(), DEPLOY.tUSDDecimals)
    } catch {}
    if (value <= 0n) {
      setProblem({ title: 'Enter an amount above 0', next: 'For example 1 or 0.5 tUSD.' })
      return null
    }
    return { key, to: to.trim() as Address, value }
  }

  /** Dry run (unless skipped), then sign, send and watch. The timeline shows each stage. */
  async function run(draft: Draft, key: Hex, opts: { skipCheck?: boolean; fixing?: Fix } = {}) {
    setStep(0)
    setFee(feeOf(draft))
    if (!opts.skipCheck) {
      // The simulator needs signed bytes; this signature is only used for the dry run. The trace lets the diagnosis flag
      // validation that reads shared storage (our paymaster reads the Uniswap v4 pool), which a swap can invalidate.
      const dx = diagnoseDraft(draftFrames(draft), await simulate(await signDraft(draft, key), true), { sender: draft.sender })
      setCheck(dx)
      if (dx.findings.some((f) => f.tone === 'fail')) {
        const f = fixable(dx.findings)
        if (f && !opts.fixing) setFix({ finding: f, oldHash: null, newHash: null })
        if (lowGas && !opts.fixing) setCaught(draft)
        setProblem({ title: 'The dry run found a problem, so nothing was sent', next: f && !opts.fixing ? 'Press Fix & send to apply the change and send.' : 'Apply the change below, then press Send again.', findings: dx.findings })
        return
      }
    }
    setStep(1)
    const h = await sendFrameTx(await signDraft(draft, key))
    setHash(h)
    setStep(2)
    let final = false
    const timer = setTimeout(() => {
      if (!final) setProblem({ title: 'No result after 2 minutes', next: 'The mempool may still include it. Open it in the explorer, or check the hash in a minute.' })
    }, 125_000)
    stop.current = watchTx(h, (s: Stage) => {
      if (s === 'admitted') return setStep(3)
      if (s === 'pending') return
      final = true
      clearTimeout(timer)
      if (s === 'included') {
        setStep(5)
        if (opts.fixing) setFix({ ...opts.fixing, newHash: h })
      } else if (s === 'failed') failedOnChain(h)
      else
        setProblem(
          s === 'rejected'
            ? { title: 'The mempool rejected it', next: 'Paste the hash into the search box above to see which rule failed and what to change.' }
            : { title: 'The mempool dropped it before inclusion', next: 'Press Send again to build a fresh transaction.' },
        )
    })
  }

  /** Included but a frame failed: diagnose the receipt, and offer Fix & send when it's a gas problem. */
  async function failedOnChain(h: Hex) {
    const [tx, receipt] = await Promise.all([getTx('miner', h).catch(() => null), getReceipt(h).catch(() => null)])
    const findings = tx && receipt ? diagnose(tx, receipt).findings : []
    const f = fixable(findings)
    if (f) setFix({ finding: f, oldHash: h, newHash: null })
    setProblem({ title: 'It was included, but a frame failed', next: f ? 'Press Fix & send to apply the change and send again.' : 'Paste the hash into the search box above to see which frame failed and why.', findings })
  }

  const fail = (e: unknown) => setProblem({ title: "Couldn't reach the devnet", next: `${(e as Error).message}. Check your connection and try again.` })

  async function send() {
    reset()
    setFix(null)
    const p = inputs()
    if (!p) return
    try {
      const built = await buildSendTx({ wallet: privateKeyToAccount(p.key).address, to: p.to, amount: p.value, ...ADDRS })
      const draft = lowGas ? { ...built, frames: built.frames.map((f, i, all) => (i === all.length - 1 ? { ...f, gas: LOW_GAS } : f)) } : built
      await run(draft, p.key)
    } catch (e) {
      fail(e)
    }
  }

  async function sendAnyway() {
    const key = loadKey()
    if (!caught || !key) return
    const draft = caught
    reset()
    setFix(null)
    try {
      await run(draft, key, { skipCheck: true })
    } catch (e) {
      fail(e)
    }
  }

  async function fixAndSend() {
    const p = inputs()
    if (!p || !fix) return
    const current = fix
    reset()
    try {
      // Rebuild for a fresh nonce (a failed tx on chain used the old one), apply the gas fix, then re-quote the fee,
      // because a higher gas limit raises the maximum cost the paymaster prices.
      const built = await buildSendTx({ wallet: privateKeyToAccount(p.key).address, to: p.to, amount: p.value, ...ADDRS })
      const fixed = await requote(await applyPatch(built, current.finding.patch, ADDRS), ADDRS)
      await run(fixed, p.key, { fixing: current })
    } catch (e) {
      fail(e)
    }
  }

  return (
    <section className="send" aria-label="Send tUSD">
      <div className="wallet-head">
        <h2>Send tUSD</h2>
        <span className="muted">Gas is paid in tUSD. The wallet needs no ETH.</span>
      </div>
      <form
        className="send-form"
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
      >
        <label>
          Recipient
          <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="0x…" spellCheck={false} autoComplete="off" />
        </label>
        <label>
          Amount (tUSD)
          <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1.0" inputMode="decimal" autoComplete="off" />
        </label>
        {/* One primary button per screen: while a fix is offered, Fix & send is the primary one. */}
        <button type="submit" className={fix && !fix.newHash ? '' : 'primary'} disabled={busy}>
          {busy ? 'Sending' : 'Send'}
        </button>
      </form>
      <label className="toggle send-low">
        <input type="checkbox" checked={lowGas} onChange={(e) => setLowGas(e.target.checked)} /> Send with low gas (demo)
      </label>

      {step !== null && (
        <ol className="timeline" aria-live="polite">
          {STEPS.map((label, i) => {
            const state = problem && i === step ? 'fail' : i < step ? 'pass' : i === step && step < 5 ? 'now' : 'todo'
            return (
              <li key={label} className={state}>
                <span className="t-dot" aria-hidden="true" />
                <span>{label}</span>
                <span className="sr"> ({state === 'pass' ? 'done' : state === 'now' ? 'in progress' : state === 'fail' ? 'failed' : 'not started'})</span>
              </li>
            )
          })}
        </ol>
      )}

      {hash && (
        <p className="send-hash">
          <code>{hash}</code>{' '}
          <a href={EXPLORER(hash, 'miner')} target="_blank" rel="noreferrer">
            Open in explorer
          </a>
        </p>
      )}
      {fee !== null && step === 5 && (
        <p className="send-fee">
          Gas paid: {formatUnits(fee, DEPLOY.tUSDDecimals)} tUSD, ETH used: 0
          <span className="muted"> · priced live by our paymaster from the Uniswap v4 ETH/tUSD pool</span>
        </p>
      )}

      {check && !problem && (
        <div className="drycheck" aria-label="Dry run result">
          <p className="f-title">Dry run</p>
          <VerdictLine label="Mempools" v={check.mempool} />
          <VerdictLine label="Execution" v={check.chain} />
          {check.findings
            .filter((f) => f.tone === 'warn' || f.tone === 'info')
            .map((f, i) => (
              <p key={i} className={`dry-note ${f.tone}`}>
                <strong>{f.title}.</strong> {f.why}
              </p>
            ))}
        </div>
      )}

      {fix && <FixAndSend finding={fix.finding} oldHash={fix.oldHash} newHash={fix.newHash} busy={busy} onFix={fixAndSend} />}

      {problem && (
        <div className="send-problem" role="alert">
          <p className="f-title">{problem.title}</p>
          <p>{problem.next}</p>
          {caught && (
            <button type="button" onClick={sendAnyway}>
              Send anyway (demo: it will fail on chain)
            </button>
          )}
          {problem.findings && (
            <ol className="findings">
              {problem.findings.map((f, i) => (
                <li key={i} className={`finding ${f.tone}`}>
                  <div className="f-title">{f.title}</div>
                  {f.fix && <p className="fix">{f.fix}</p>}
                  <p className="why">{f.why}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  )
}

function VerdictLine({ label, v }: { label: string; v: Verdict }) {
  return (
    <p className="v-row">
      <span className={`dot ${v.tone}`} aria-hidden="true" />
      <span>
        <span className="muted">{label}: </span>
        <strong>{v.headline}</strong> <span className="muted">· {v.sub}</span>
      </span>
    </p>
  )
}
