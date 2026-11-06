'use client'

// Header dropdown: the demo account that signs frame txs (address, balances, key import, faucet), so the page itself
// keeps one clean "Send & fix" card. Reuses the Wallet panel and the Faucet unchanged inside the dropdown.
import { useEffect, useRef, useState } from 'react'
import { formatUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { balances, loadKey, Wallet } from './Wallet'
import { Faucet } from './Faucet'
import { DEPLOY } from './deploy'

export function DemoAccount() {
  const [open, setOpen] = useState(false)
  const [tusd, setTusd] = useState<bigint | null>(null)
  const box = useRef<HTMLDivElement>(null)

  // The balance on the button follows the signing account (or the demo wallet before a key is imported).
  const refresh = async () => {
    const key = loadKey()
    const who = key ? privateKeyToAccount(key).address : DEPLOY.demoWallet
    if (!who) return
    try {
      setTusd((await balances(who, DEPLOY.tUSD)).tusd)
    } catch {
      /* the panel shows its own error */
    }
  }
  useEffect(() => {
    void refresh()
    const onChange = () => void refresh()
    window.addEventListener('readmit:balances', onChange)
    const t = setInterval(onChange, 30_000)
    return () => {
      window.removeEventListener('readmit:balances', onChange)
      clearInterval(t)
    }
  }, [])
  useEffect(() => {
    if (!open) return
    void refresh()
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const bal = tusd != null ? Number(formatUnits(tusd, DEPLOY.tUSDDecimals)).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '–'

  return (
    <div className="acct" ref={box}>
      <button type="button" className="acct-btn" aria-expanded={open} aria-controls="acct-pop" onClick={() => setOpen((o) => !o)}>
        Demo account <span className="acct-bal">{bal} tUSD</span>
        <span aria-hidden="true">▾</span>
      </button>
      <div className="acct-pop" id="acct-pop" role="dialog" aria-label="Demo account" hidden={!open}>
        <Wallet />
        <Faucet />
      </div>
    </div>
  )
}
