'use client'

// Real faucet, not a mock: one frame transaction from the demo account that calls tUSD.mint(self, 100) (TestERC20's mint
// is public). Gas is paid in tUSD to our paymaster like any send, and it is dry-run before it is broadcast.
// Lives in the header; progress shows in a small popover under the button.
import { useEffect, useRef, useState } from 'react'
import { privateKeyToAccount } from 'viem/accounts'
import { buildFaucetTx, draftFrames, signDraft } from '../engine/frames'
import { EXPLORER, sendFrameTx, simulate, watchTx, type Stage } from '../rpc'
import { diagnoseDraft } from '../diagnose'
import { loadKey } from './Wallet'
import { DEPLOY } from './deploy'

const AMOUNT = 100n * 10n ** BigInt(DEPLOY.tUSDDecimals)
type State = 'idle' | 'checking' | Stage

const LABEL: Record<State, string> = {
  idle: '',
  checking: 'Checking (dry run)…',
  pending: 'Sent, waiting for the mempool…',
  admitted: 'Admitted, waiting for a block…',
  included: 'Included: 100 tUSD minted to the demo account.',
  rejected: 'Rejected by the mempool. Try again.',
  failed: 'Included but failed on chain. Try again.',
  dropped: 'The mempool dropped it before inclusion. Try again.',
}

export function Faucet() {
  const [state, setState] = useState<State>('idle')
  const [hash, setHash] = useState<string | null>(null)
  const [error, setError] = useState<'' | 'nokey' | string>('')
  const [open, setOpen] = useState(false)
  const stop = useRef<(() => void) | null>(null)
  useEffect(() => () => stop.current?.(), [])
  const busy = state === 'checking' || state === 'pending' || state === 'admitted'

  async function mint() {
    setOpen(true)
    setError('')
    setHash(null)
    const key = loadKey()
    if (!key) {
      setError('nokey')
      setState('idle')
      return
    }
    try {
      setState('checking')
      const draft = await buildFaucetTx({ wallet: privateKeyToAccount(key).address, amount: AMOUNT, tUSD: DEPLOY.tUSD, paymaster: DEPLOY.paymaster })
      const dx = diagnoseDraft(draftFrames(draft), await simulate(await signDraft(draft, key)), { sender: draft.sender })
      const bad = dx.findings.find((f) => f.tone === 'fail')
      if (bad) {
        setError(`${bad.title}. ${bad.fix ?? ''}`)
        setState('idle')
        return
      }
      const h = await sendFrameTx(await signDraft(draft, key))
      setHash(h)
      setState('pending')
      stop.current = watchTx(h, (s) => {
        setState(s)
        if (s === 'included') window.dispatchEvent(new Event('readmit:balances'))
      })
    } catch (e) {
      setError((e as Error).message.split('\n')[0])
      setState('idle')
    }
  }

  return (
    <div className="faucet">
      <button type="button" className="faucet-btn" onClick={mint} disabled={busy} aria-describedby={open ? 'faucet-pop' : undefined}>
        {busy ? 'Getting tUSD…' : (
          <>
            Get <span className="faucet-long">100 test </span>tUSD
          </>
        )}
      </button>
      {open && (state !== 'idle' || error) && (
        <div className="faucet-pop" id="faucet-pop" role="status">
          <button type="button" className="faucet-close" aria-label="Close" onClick={() => setOpen(false)}>
            ×
          </button>
          {state !== 'idle' && <p className={state === 'included' ? 'faucet-ok' : ''}>{LABEL[state]}</p>}
          {hash && (
            <p className="faucet-hash">
              <code>
                {hash.slice(0, 10)}…{hash.slice(-6)}
              </code>{' '}
              <a href={EXPLORER(hash, 'miner')} target="_blank" rel="noreferrer">
                Open in explorer
              </a>
            </p>
          )}
          {error === 'nokey' ? (
            <p className="error" role="alert">
              Import the demo key in the{' '}
              <a href="#demo-key" onClick={() => setOpen(false)}>
                wallet panel
              </a>{' '}
              first.
            </p>
          ) : error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
          <p className="faucet-note">A real frame tx that mints test tUSD to the demo account. Gas is paid in tUSD; dry-run first.</p>
        </div>
      )}
    </div>
  )
}
