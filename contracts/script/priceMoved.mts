// T09: build the "price moved under you" fixture.
//   plan (default, read-only): sign a send at the current quote, compute the tUSD swap that flips it to underpaid, simulate.
//   --go: also swap on the pool (ONE of the 3 allowed MovePrice runs), then send the stale tx to the gateway and save the report.
// Keys come from contracts/.env (DEMO_KEY = demo wallet, DEPLOYER_KEY = pool deployer who holds tUSD). Never printed.
// Run from the repo root:  node contracts/script/priceMoved.mts [--go]
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createPublicClient, createWalletClient, http, keccak256, type Hex } from 'viem'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { buildSendTx, signDraft, maxCostBound, quote, decodeDraft } from '../../src/engine/frames.ts'
import { simulate, sendFrameTx, getTx, ETHREX } from '../../src/rpc.ts'

const go = process.argv.includes('--go')
const dep = JSON.parse(readFileSync('contracts/deployments/1337.json', 'utf8'))
const env: Record<string, string> = {}
if (existsSync('contracts/.env')) for (const l of readFileSync('contracts/.env', 'utf8').split('\n')) { const m = l.match(/^(\w+)=(\S+)/); if (m) env[m[1]] = m[2] }
if (go && !(env.DEMO_KEY && env.DEPLOYER_KEY)) throw new Error('--go needs DEMO_KEY and DEPLOYER_KEY in contracts/.env')
const demoKey = (env.DEMO_KEY ?? generatePrivateKey()) as Hex
const wallet = env.DEMO_KEY ? privateKeyToAccount(demoKey).address : dep.demoWallet
if (env.DEMO_KEY && wallet.toLowerCase() !== dep.demoWallet.toLowerCase()) throw new Error('DEMO_KEY does not match deployments demoWallet')

const addrs = { tUSD: dep.tUSD, paymaster: dep.paymaster }
const to = '0x000000000000000000000000000000000000dEaD'
const draft = await buildSendTx({ wallet: dep.demoWallet, to, amount: 1n, ...addrs })
const maxCost = maxCostBound(draft)
const paid = await quote(dep.paymaster, maxCost) // what the tx pays now
// Push sqrtP up 1% (quote up ~2%, so the signed fee is short by 2%): currency1 in = L * dSqrtP / 2^96, grossed up for the 0.3% fee.
const Q96 = 2n ** 96n
const STATE_VIEW = '0xd89a052862AaA34f0B6cc7f3B6a9D080584a43FB'
const svAbi = [
  { type: 'function', name: 'getSlot0', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'uint160' }, { type: 'int24' }, { type: 'uint24' }, { type: 'uint24' }] },
  { type: 'function', name: 'getLiquidity', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'uint128' }] },
] as const
const rc = createPublicClient({ transport: http(ETHREX) })
const [[sqrtP], L] = await Promise.all([
  rc.readContract({ address: STATE_VIEW, abi: svAbi, functionName: 'getSlot0', args: [dep.poolId] }),
  rc.readContract({ address: STATE_VIEW, abi: svAbi, functionName: 'getLiquidity', args: [dep.poolId] }),
])
const flip = { currency1In: (((L * (sqrtP / 100n)) / Q96) * 1_000_000n) / 997_000n + 1n }
console.log({ nonce: draft.nonce, maxCost, paid, sqrtP, L, tusdInForMove: flip.currency1In })
if (!go) { console.log('plan only (no keys used, nothing sent). Re-run with --go to spend one MovePrice.'); process.exit(0) }

const raw = await signDraft(draft, demoKey)
const hash = keccak256(raw) // placeholder; the real hash comes back from the send
console.log('pre-move simulate:', (await simulate(raw)).status ?? 'ok')

// MovePrice, exact-in tUSD with 5% headroom over the flip point (negative = exact-in)
const dKey = env.DEPLOYER_KEY as Hex
const acct = privateKeyToAccount(dKey)
const chain = { id: 1337, name: 'alt', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [ETHREX] } } } as const
const wc = createWalletClient({ account: acct, chain, transport: http(ETHREX) })
const pc = createPublicClient({ chain, transport: http(ETHREX) })
const swapAbi = [{ type: 'function', name: 'swap', stateMutability: 'payable', inputs: [
  { name: 'key', type: 'tuple', components: [{ name: 'currency0', type: 'address' }, { name: 'currency1', type: 'address' }, { name: 'fee', type: 'uint24' }, { name: 'tickSpacing', type: 'int24' }, { name: 'hooks', type: 'address' }] },
  { name: 'params', type: 'tuple', components: [{ name: 'zeroForOne', type: 'bool' }, { name: 'amountSpecified', type: 'int256' }, { name: 'sqrtPriceLimitX96', type: 'uint160' }] },
  { name: 'testSettings', type: 'tuple', components: [{ name: 'takeClaims', type: 'bool' }, { name: 'settleUsingBurn', type: 'bool' }] },
  { name: 'hookData', type: 'bytes' }], outputs: [{ type: 'int256' }] }] as const
const tusdIn = (flip.currency1In * 105n) / 100n
const sw = await wc.writeContract({ address: dep.swapper, abi: swapAbi, functionName: 'swap', gas: 1_500_000n, args: [
  { currency0: '0x0000000000000000000000000000000000000000', currency1: dep.tUSD, fee: 3000, tickSpacing: 60, hooks: '0x0000000000000000000000000000000000000000' },
  { zeroForOne: false, amountSpecified: -tusdIn, sqrtPriceLimitX96: 1461446703485210103287273052203988822378723970341n },
  { takeClaims: false, settleUsingBurn: false }, '0x'] })
console.log('MovePrice tx', sw, (await pc.waitForTransactionReceipt({ hash: sw })).status)
console.log('quote now', await quote(dep.paymaster, maxCost), 'signed fee', paid)

// Send the stale tx to the gateway; it should be rejected as underpaid in VERIFY.
let sent: Hex | undefined, err: string | undefined
try { sent = await sendFrameTx(raw, 'gateway') } catch (e) { err = String(e) }
console.log({ sent, err })
const h = (sent ?? hash) as Hex
const report = await getTx('gateway', h)
writeFileSync('src/samples/price-moved.json', JSON.stringify({ name: 'price-moved', hash: h, node: 'gateway', note: 'Signed at the paymaster quote, then MovePrice raised the quote before the send; VERIFY fails underpaid.', sendError: err, tx: report }, null, 2))
console.log('saved src/samples/price-moved.json')
