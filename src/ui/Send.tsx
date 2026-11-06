import { useEffect, useRef, useState } from 'react'
import { formatUnits, isAddress, parseUnits, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { diagnoseDraft, type Finding } from '../diagnose'
import { buildSendTx, draftFrames, signDraft, type Draft } from '../engine/frames'
import { EXPLORER, sendFrameTx, simulate, watchTx, type Stage } from '../rpc'
import { DEPLOY } from './deploy'
import { loadKey } from './Wallet'

const STEPS = ['Checking (dry run)', 'Signing', 'Sent', 'Admitted', 'Included'] as const
type Step = 0 | 1 | 2 | 3 | 4 | 5 // index of the step in progress; 5 = all done
type Problem = { title: string; next: string; findings?: Finding[] }

// The fee frame is `tUSD.transfer(paymaster, fee)`: the amount is the last 32 bytes of its calldata.
const feeOf = (d: Draft) => BigInt(`0x${d.frames[2].data.slice(-64)}`)

export function Send() {
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [step, setStep] = useState<Step | null>(null)
  const [hash, setHash] = useState<Hex | null>(null)
  const [fee, setFee] = useState<bigint | null>(null)
  const [problem, setProblem] = useState<Problem | null>(null)
  const stop = useRef<() => void>(() => {})
  useEffect(() => () => stop.current(), [])

  const busy = step !== null && step < 5 && !problem

  async function send() {
    setProblem(null)
    setHash(null)
    setFee(null)
    stop.current()
    const key = loadKey()
    if (!key) return setProblem({ title: 'No key imported', next: 'Import the demo key in the wallet panel first.' })
    if (!DEPLOY.tUSD || !DEPLOY.paymaster) return setProblem({ title: 'The tUSD token and paymaster are not deployed yet', next: 'Sending works once the contracts are on the devnet.' })
    if (!isAddress(to.trim())) return setProblem({ title: 'That recipient is not an address', next: 'Enter 0x followed by 40 hex characters.' })
    let value: bigint
    try {
      value = parseUnits(amount.trim(), 18)
    } catch {
      value = 0n
    }
    if (value <= 0n) return setProblem({ title: 'Enter an amount above 0', next: 'For example 1 or 0.5 tUSD.' })

    try {
      setStep(0)
      const wallet = privateKeyToAccount(key).address
      const draft = await buildSendTx({ wallet, to: to.trim() as Address, amount: value, tUSD: DEPLOY.tUSD, paymaster: DEPLOY.paymaster })
      setFee(feeOf(draft))
      // The simulator needs signed bytes; this signature is only used for the dry run.
      const dx = diagnoseDraft(draftFrames(draft), await simulate(await signDraft(draft, key)))
      if (dx.findings.some((f) => f.tone === 'fail' || f.tone === 'warn')) {
        return setProblem({ title: 'The dry run found a problem, so nothing was sent', next: 'Apply the change below, then press Send again.', findings: dx.findings })
      }
      setStep(1)
      const raw = await signDraft(draft, key)
      const h = await sendFrameTx(raw)
      setHash(h)
      setStep(2)
      let final = false
      const timer = setTimeout(() => {
        if (!final) setProblem({ title: 'No result after 2 minutes', next: 'The mempool may still include it. Open it in the explorer, or check the hash above in a minute.' })
      }, 125_000)
      stop.current = watchTx(h, (s: Stage) => {
        if (s === 'admitted') setStep(3)
        else if (s === 'included') {
          final = true
          clearTimeout(timer)
          setStep(5)
        } else if (s === 'rejected' || s === 'failed' || s === 'dropped') {
          final = true
          clearTimeout(timer)
          setProblem(
            s === 'rejected'
              ? { title: 'The mempool rejected it', next: 'Paste the hash into the search box above to see which rule failed and what to change.' }
              : s === 'failed'
                ? { title: 'It was included, but a frame failed', next: 'Paste the hash into the search box above to see which frame failed and why.' }
                : { title: 'The mempool dropped it before inclusion', next: 'Press Send again to build a fresh transaction.' },
          )
        }
      })
    } catch (e) {
      setProblem({ title: "Couldn't reach the devnet", next: `${(e as Error).message}. Check your connection and press Send again.` })
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
        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Sending' : 'Send'}
        </button>
      </form>

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
          <a href={EXPLORER(hash, 'gateway')} target="_blank" rel="noreferrer">
            Open in explorer
          </a>
        </p>
      )}
      {fee !== null && step === 5 && (
        <p className="send-fee">
          Gas paid: {formatUnits(fee, 18)} tUSD, ETH used: 0
        </p>
      )}

      {problem && (
        <div className="send-problem" role="alert">
          <p className="f-title">{problem.title}</p>
          <p>{problem.next}</p>
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
