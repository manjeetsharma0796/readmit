import type { Admission, Receipt, TxResult } from './diagnose'

// Alt-mempool devnet (chain 1337). All endpoints send CORS *, so this runs in the browser with no backend.
export const NODES = {
  gateway: { label: 'Gateway', url: 'https://altmempoolgateway.forshtat.com/rpc' },
  miner: { label: 'Miner', url: 'https://altmempool.forshtat.com/rpc' },
} as const
export type NodeId = keyof typeof NODES
export const ETHREX = 'https://altmempool.forshtat.com'
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
