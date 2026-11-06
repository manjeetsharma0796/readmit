import { useEffect, useState } from 'react'
import { formatEther, formatUnits, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { ETHREX } from '../rpc'
import { DEPLOY } from './deploy'


const KEY = 'readmit.demoKey'
// The right shape is not enough: 0x00…00 or 0xff…ff look like keys but are outside the secp256k1 range and crash signing.
const isKey = (k: string): k is Hex => {
  if (!/^0x[0-9a-fA-F]{64}$/.test(k)) return false
  try {
    privateKeyToAccount(k as Hex)
    return true
  } catch {
    return false
  }
}
// Used when the browser blocks localStorage, so the key still works until the page is reloaded.
let memoryKey: Hex | null = null

/** The imported test key, or null. It lives in this browser's localStorage only (or memory, if storage is blocked). */
export function loadKey(): Hex | null {
  try {
    const k = localStorage.getItem(KEY) ?? ''
    if (isKey(k)) return k
  } catch {}
  return memoryKey
}

async function call<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(ETHREX, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
  const json = await res.json()
  if (json.error) throw new Error(json.error.message)
  return json.result as T
}

type Balances = { eth: bigint; tusd: bigint | null }
async function balances(wallet: Address, token: Address | null): Promise<Balances> {
  // balanceOf(address) is 0x70a08231 followed by the address padded to 32 bytes.
  const data = `0x70a08231${wallet.slice(2).toLowerCase().padStart(64, '0')}`
  const [eth, tusd] = await Promise.all([
    call<Hex>('eth_getBalance', [wallet, 'latest']),
    token ? call<Hex>('eth_call', [{ to: token, data }, 'latest']) : Promise.resolve(null),
  ])
  return { eth: BigInt(eth), tusd: tusd && tusd !== '0x' ? BigInt(tusd) : null }
}

export function Wallet() {
  const [key, setKey] = useState<Hex | null>(loadKey)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [bal, setBal] = useState<Balances | null>(null)
  const [balError, setBalError] = useState('')
  // Balances are for the account that actually signs sends; before a key is imported, for the demo wallet.
  const signer = key ? privateKeyToAccount(key).address : null
  const wallet = signer ?? DEPLOY.demoWallet
  const notDemo = !!signer && !!DEPLOY.demoWallet && signer.toLowerCase() !== DEPLOY.demoWallet.toLowerCase()

  const refresh = async () => {
    if (!wallet) return
    setBalError('')
    try {
      setBal(await balances(wallet, DEPLOY.tUSD))
    } catch (e) {
      setBalError(`Couldn't read balances: ${(e as Error).message}`)
    }
  }
  useEffect(() => {
    refresh()
  }, [wallet])
  // The faucet (T57) announces a mint so the balance updates without a manual refresh.
  useEffect(() => {
    const onMint = () => void refresh()
    window.addEventListener('readmit:balances', onMint)
    return () => window.removeEventListener('readmit:balances', onMint)
  }, [wallet])

  function save() {
    const k = draft.trim()
    if (!isKey(k)) {
      setError(/^0x[0-9a-fA-F]{64}$/.test(k) ? "That isn't a valid private key (it's outside the allowed range)." : 'A private key is 0x followed by 64 hex characters.')
      return
    }
    setError('')
    memoryKey = k
    try {
      localStorage.setItem(KEY, k)
    } catch {
      setError("This browser won't let the page store the key. It will work until you reload.")
    }
    setKey(k)
    setDraft('')
  }

  function forget() {
    try {
      localStorage.removeItem(KEY)
    } catch {}
    memoryKey = null
    setKey(null)
  }

  return (
    <section className="wallet" aria-label="Demo wallet">
      <div className="wallet-head">
        <h2>Demo wallet</h2>
        <span className="note">Test key, devnet only. Stored in this browser, never sent anywhere.</span>
      </div>
      <p className="muted wallet-why">Browser wallets can&apos;t sign EIP-8141 frame transactions yet, so sends are signed by this shared demo account. A wallet connected at the top is for identity only.</p>

      <dl className="overview">
        <dt>{signer ? 'Sends from' : 'Demo wallet'}</dt>
        <dd>
          {wallet ? <code>{wallet}</code> : <span className="muted">Not deployed yet</span>}
          {notDemo && <span className="note"> This key is not the demo wallet, so balances and sends use this account.</span>}
        </dd>
        <dt>tUSD</dt>
        <dd>{bal?.tusd != null ? `${formatUnits(bal.tusd, DEPLOY.tUSDDecimals)} tUSD` : <span className="muted">–</span>}</dd>
        <dt>ETH</dt>
        <dd>{bal ? `${formatEther(bal.eth)} ETH` : <span className="muted">–</span>}</dd>
        <dt>Signing key</dt>
        <dd>
          {key ? (
            <span className="wallet-key">
              <span className="muted">Imported</span>
              <button type="button" onClick={forget}>
                Forget key
              </button>
            </span>
          ) : (
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault()
                save()
              }}
            >
              <label htmlFor="demo-key" className="sr">
                Import demo key
              </label>
              <input id="demo-key" type="password" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Import demo key (0x…)" autoComplete="off" spellCheck={false} aria-invalid={!!error} aria-describedby={error ? 'demo-key-error' : undefined} />
              <button type="submit">Import</button>
            </form>
          )}
        </dd>
      </dl>
      {error && (
        <p className="error" role="alert" id="demo-key-error">
          {error}
        </p>
      )}
      {balError && <p className="error">{balError}</p>}
      {wallet && (
        <button type="button" className="wallet-refresh" onClick={refresh}>
          Refresh balances
        </button>
      )}
    </section>
  )
}
