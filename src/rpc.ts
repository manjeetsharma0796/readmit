import type { Admission, Receipt, Simulation, TxResult } from './diagnose'
import { profile } from '@forshtat/hegota-support/profiles/ethrex-eip8141-tracer'
import { toWire } from '@forshtat/hegota-support/rpc'
import { decodeTx } from '@forshtat/hegota-support/tx'
import type { Hex } from 'viem'

// Alt-mempool devnet (chain 1337). All endpoints send CORS *, so this runs in the browser with no backend.
// T50: the user can point Readmit at their own ethrex RPC and sidecars (Endpoints panel). Overrides live in this
// browser's localStorage and apply on the next page load, so every caller keeps reading plain constants.
export const DEFAULT_ENDPOINTS = {
  ethrex: 'https://altmempool.forshtat.com',
  gateway: 'https://altmempoolgateway.forshtat.com/rpc',
  miner: 'https://altmempool.forshtat.com/rpc',
}
export type Endpoints = typeof DEFAULT_ENDPOINTS
const ENDPOINTS_KEY = 'readmit.endpoints'
const isHttp = (u: unknown): u is string => typeof u === 'string' && /^https?:\/\/\S+$/.test(u)

/** The user's saved overrides (only valid http(s) URLs). Empty on the server or when storage is blocked. */
export function savedEndpoints(): Partial<Endpoints> {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(ENDPOINTS_KEY) ?? '{}')
    return Object.fromEntries(Object.keys(DEFAULT_ENDPOINTS).filter((k) => isHttp(raw?.[k])).map((k) => [k, raw[k]]))
  } catch {
    return {}
  }
}
/** Saves overrides (an empty or default value clears that one). The caller reloads the page to apply them. */
export function saveEndpoints(e: Partial<Endpoints>): void {
  const keep = Object.fromEntries(Object.entries(e).filter(([k, v]) => isHttp(v) && v !== DEFAULT_ENDPOINTS[k as keyof Endpoints]))
  try {
    if (Object.keys(keep).length) globalThis.localStorage?.setItem(ENDPOINTS_KEY, JSON.stringify(keep))
    else globalThis.localStorage?.removeItem(ENDPOINTS_KEY)
  } catch {
    // storage blocked: nothing to persist
  }
}
export const ENDPOINTS: Endpoints = { ...DEFAULT_ENDPOINTS, ...savedEndpoints() }

export const NODES = {
  gateway: { label: 'Gateway', url: ENDPOINTS.gateway },
  miner: { label: 'Miner', url: ENDPOINTS.miner },
} as const
export type NodeId = keyof typeof NODES
export const ETHREX = ENDPOINTS.ethrex
export const EXPLORER = (hash: string, node: NodeId) => `https://explorer.altmempool.wtf/tx/${hash}?node=${encodeURIComponent(NODES[node].url)}`

async function rpc<T>(url: string, method: string, params: unknown[] = []): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`)
  const json = await res.json()
  if (json.error) throw new Error(`${method}: ${json.error.message}`)
  return json.result as T
}

export const getTx = (node: NodeId, hash: string) => rpc<TxResult | null>(NODES[node].url, 'skandha_explorer_getTransaction', [hash])
export const getReceipt = (hash: string) => rpc<Receipt | null>(ETHREX, 'eth_getTransactionReceipt', [hash])

// Send: the sidecar takes the wire object (not raw bytes). This broadcasts: callers must have the user's go-ahead.
// Default is the miner: it is the docs' mempool RPC and bundles automatically. The gateway runs in manual bundling mode,
// so a tx sent only there is admitted but waits until someone triggers a bundle (seen live Fri 22:01).
export async function sendFrameTx(rawTx: Hex, node: NodeId = 'miner'): Promise<Hex> {
  return rpc<Hex>(NODES[node].url, 'eth_sendFrameTransaction', [toWire(decodeTx(profile, rawTx))])
}

export type Stage = 'pending' | 'admitted' | 'rejected' | 'included' | 'failed' | 'dropped'
const FINAL: Stage[] = ['rejected', 'included', 'failed', 'dropped']

/** Where a sent tx is, from the node's explorer record (mempool status values from the sidecar's explorer docs). */
export function txStage(r: TxResult | null): Stage {
  if (!r) return 'pending'
  if (r.admission?.outcome === 'rejected') return 'rejected'
  switch (r.entry?.status) {
    case 'OnChain': case 'Finalized': return 'included'
    case 'Reverted': return 'failed'
    case 'Cancelled': return 'dropped'
    case 'New': case 'Pending': case 'Submitted': return 'admitted'
  }
  return r.admission?.outcome === 'included' ? 'included' : r.admission ? 'admitted' : 'pending'
}

/** Polls every 2 s until a final stage or 120 s. Calls onUpdate on each change. Returns a stop function. */
export function watchTx(hash: string, onUpdate: (s: Stage) => void, node: NodeId = 'miner'): () => void {
  let last: Stage | null = null
  let stopped = false
  const started = Date.now()
  const tick = async () => {
    if (stopped) return
    const s = await getTx(node, hash).then(txStage, () => last ?? 'pending')
    if (s !== last) onUpdate((last = s))
    if (FINAL.includes(s) || Date.now() - started > 120_000) stopped = true
    else setTimeout(tick, 2000)
  }
  tick()
  return () => { stopped = true }
}

// Dry run on ethrex: validation + execution against the latest state. Read-only, nothing is broadcast.
export const simulate = (rawTx: string, trace = false) => rpc<Simulation>(ETHREX, 'ethrex_simulateFrameTransaction', [rawTx, 'latest', { trace }])

export type AdmissionRow = Admission & { txHash: string; node: NodeId }
export async function recent(node: NodeId, limit = 60): Promise<AdmissionRow[]> {
  const r = await rpc<{ items: (Admission & { txHash: string })[] }>(NODES[node].url, 'skandha_explorer_listAdmissions', [{ limit }])
  return r.items.map((i) => ({ ...i, node }))
}

// 4-byte selector names for calldata and revert data (sourcify signature database, CORS *).
const cache = new Map<string, string | null>()
export async function lookupSelectors(selectors: string[]): Promise<Map<string, string | null>> {
  const todo = [...new Set(selectors.map((s) => s.toLowerCase()))].filter((s) => /^0x[0-9a-f]{8}$/.test(s) && !cache.has(s))
  if (todo.length) {
    try {
      const r = await fetch(`https://api.4byte.sourcify.dev/signature-database/v1/lookup?function=${todo.join(',')}&filter=true`).then((x) => x.json())
      for (const s of todo) cache.set(s, r?.result?.function?.[s]?.[0]?.name ?? null)
    } catch {
      // Lookup is a nicety; raw selectors still show.
    }
  }
  return cache
}
