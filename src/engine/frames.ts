// Frame transaction builder and signer for the alt-mempool devnet (chain 1337, profile ethrex-eip8141-tracer).
// A Draft is plain, editable data: the UI can change a frame's gas and re-sign (Fix & send) without rebuilding.
import { profile } from '@forshtat/hegota-support/profiles/ethrex-eip8141-tracer'
import { decodeTx, encodeTx, newTx, secp256k1Placeholder, signTx, type FrameTx } from '@forshtat/hegota-support/tx'
import { rpc } from '@forshtat/hegota-support/rpc'
import { decodeFunctionResult, encodeFunctionData, type Address, type Hex } from 'viem'
import { ETHREX } from '../rpc.ts'

export type FrameSpec = {
  mode: 1 | 2 // 1 = VERIFY, 2 = SENDER (profile frameModes)
  target: Address | null // null = the sender itself
  gas: bigint
  stateGas: bigint
  value: bigint
  data: Hex
  flags?: number // low bits: approve scope (1 PAYMENT, 2 EXECUTION, 3 both)
}
export type Draft = { sender: Address; nonce: bigint; frames: FrameSpec[]; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }
export type Addrs = { tUSD: Address; paymaster: Address }

const CHAIN_ID = 1337
// Default limits. The dry run (simulate) reports real usage; Fix & send adjusts from there.
// The two VERIFY frames together must stay under the sidecar's 100,000 validation cap (signature cost included).
const GAS = { walletVerify: 25_000n, paymasterVerify: 60_000n, transfer: 60_000n, transferState: 100_000n }
// Overhead the chain adds on top of the frame limits (intrinsic + signature). The simulator showed ~16,750; keep slack.
const OVERHEAD = 50_000n

const ERC20 = [
  { type: 'function', name: 'transfer', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
] as const
const PAYMASTER = [
  { type: 'function', name: 'quote', stateMutability: 'view', inputs: [{ name: 'weiCost', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
] as const

export const transferData = (to: Address, amount: bigint) => encodeFunctionData({ abi: ERC20, functionName: 'transfer', args: [to, amount] })

/** Upper bound of what the chain may charge: every frame limit plus overhead, at maxFeePerGas. */
export const maxCostBound = (d: Pick<Draft, 'frames' | 'maxFeePerGas'>) =>
  (d.frames.reduce((s, f) => s + f.gas + f.stateGas, 0n) + OVERHEAD) * d.maxFeePerGas

/** The paymaster's own price for a gas cost in wei, read from its `quote()` (Uniswap v4 slot0 + 10%). */
export async function quote(paymaster: Address, weiCost: bigint): Promise<bigint> {
  const data = encodeFunctionData({ abi: PAYMASTER, functionName: 'quote', args: [weiCost] })
  const out = await rpc(ETHREX, 'eth_call', [{ to: paymaster, data }, 'latest'])
  return decodeFunctionResult({ abi: PAYMASTER, functionName: 'quote', data: out })
}

/** The 4 frames of "send tUSD, pay gas in tUSD", before the fee amount is known. */
export function sendFrames(a: Addrs, to: Address, amount: bigint, fee: bigint): FrameSpec[] {
  return [
    { mode: 1, target: null, gas: GAS.walletVerify, stateGas: 0n, value: 0n, data: '0x', flags: 2 }, // wallet approves execution
    { mode: 1, target: a.paymaster, gas: GAS.paymasterVerify, stateGas: 0n, value: 0n, data: '0x', flags: 1 }, // paymaster approves payment
    { mode: 2, target: a.tUSD, gas: GAS.transfer, stateGas: GAS.transferState, value: 0n, data: transferData(a.paymaster, fee) }, // must directly follow the paymaster frame
    { mode: 2, target: a.tUSD, gas: GAS.transfer, stateGas: GAS.transferState, value: 0n, data: transferData(to, amount) },
  ]
}

/** Builds a Flow B draft: send `amount` tUSD to `to`, with gas paid in tUSD to our paymaster. Reads nonce, fees and quote from the devnet. */
export async function buildSendTx(p: { wallet: Address; to: Address; amount: bigint } & Addrs): Promise<Draft> {
  const [nonce, gasPrice] = await Promise.all([
    rpc(ETHREX, 'eth_getTransactionCount', [p.wallet, 'pending']).then(BigInt),
    rpc(ETHREX, 'eth_gasPrice', []).then(BigInt),
  ])
  const base = { sender: p.wallet, nonce, maxFeePerGas: gasPrice * 2n, maxPriorityFeePerGas: gasPrice }
  // The fee transfer's amount does not change the max cost (same calldata size), so quote once on the final limits.
  const fee = await quote(p.paymaster, maxCostBound({ ...base, frames: sendFrames(p, p.to, p.amount, 0n) }))
  return { ...base, frames: sendFrames(p, p.to, p.amount, fee) }
}

export function toFrameTx(d: Draft): FrameTx {
  return newTx({
    chainId: CHAIN_ID,
    sender: d.sender,
    nonceSeq: d.nonce,
    fees: { maxFeePerGas: d.maxFeePerGas, maxPriorityFeePerGas: d.maxPriorityFeePerGas },
    signatures: [secp256k1Placeholder(profile)],
    frames: d.frames.map((f) => ({ mode: f.mode, flags: f.flags ?? 0, target: f.target, limits: { execution: f.gas, state: f.stateGas }, value: f.value, data: f.data })),
  })
}

/** Signs with a secp256k1 key (the sender's default VERIFY code checks it) and returns the raw tx bytes. */
export async function signDraft(d: Draft, key: Hex): Promise<Hex> {
  return encodeTx(profile, await signTx(profile, toFrameTx(d), key))
}

/** Inverse of signDraft's encoding, for checks and for showing what was signed. */
export function decodeDraft(raw: Hex): Draft {
  const t = decodeTx(profile, raw)
  return {
    sender: t.sender,
    nonce: t.nonceSeq,
    maxFeePerGas: t.fees.maxFeePerGas,
    maxPriorityFeePerGas: t.fees.maxPriorityFeePerGas,
    frames: t.frames.map((f) => ({ mode: f.mode as 1 | 2, target: f.target, gas: f.limits.execution, stateGas: f.limits.state, value: f.value, data: f.data, flags: f.flags })),
  }
}
