# @readmit/sdk

Build, dry-run, diagnose, fix, send and watch **EIP-8141 frame transactions** on an **ERC-8421 alternative mempool**. It's the engine behind [Readmit](../README.md), packaged for your own code: plain TypeScript on viem and `@forshtat/hegota-support`, with no backend.

```bash
npm run check --prefix sdk          # 21 offline cases
node sdk/check.ts --live            # plus read-only calls to the public devnet (sends nothing)
npm run build --prefix sdk          # emits sdk/dist (JS + .d.ts)
```

It isn't published to npm yet. Use it from a clone (Node 23.6+ runs the `.ts` directly), or build it and depend on `sdk/`.

## Quick start

```ts
import { createReadmit, ALT_MEMPOOL_DEVNET, verifyFrame, senderFrame, SCOPE } from '@readmit/sdk'

const r = createReadmit(ALT_MEMPOOL_DEVNET) // or { ethrex, gateway?, miner?, chainId } for your own nodes

// Why did this fail? Works for anyone's tx, including ones the mempool rejected (no block explorer has those).
const dx = await r.explain('0x3fd9…4b9c')
dx.findings[0] // { tone, frame?, title, why, fix?, patch? }, worst first

// Build any frame tx; nonce and fees are filled from the node.
const draft = await r.buildFrameTx({
  sender,
  frames: [
    verifyFrame(SCOPE.BOTH, { gas: 10_000n }),                    // the sender checks its own signature and pays
    senderFrame({ target: token, gas: 60_000n, data: calldata }), // a call made as the sender
  ],
})

// Dry run → apply the fix if one is suggested → dry run again → send. Throws DryRunFailed if a problem has no fix.
const { hash } = await r.sendDraft(draft, signer)
const receipt = await r.waitForInclusion(hash) // or throws TxNotIncluded (rejected / failed / dropped, with a diagnosis)
```

## Features

| Area | API |
|---|---|
| **Config** | `createReadmit({ ethrex, gateway?, miner?, chainId, defaultNode?, profile?, minMaxFeePerGas? })`. Each endpoint is a URL or your own `(method, params) => Promise` transport. `ALT_MEMPOOL_DEVNET` holds the public devnet's endpoints. |
| **Explain** | `r.explain(hash)` = fetch + `diagnose`, trying the other node if the first never saw it. `r.getTx(hash)` returns the sidecar record plus the admission report with every rule it ran; `r.getReceipt(hash)` |
| **Dry run** | `r.simulate(raw, { trace?, block? })`, `r.dryRun(draft, signer)` → `{ raw, simulation, diagnosis, ok }` |
| **Diagnose** | `diagnose(tx, receipt)`, `diagnoseDraft(frames, sim, { sender })`. They return 3 verdicts and findings with a machine-readable `patch`. They cover 10+ rejection classes by the sidecar's rule names (100k validation cap, unstaked storage, banned opcodes, payer solvency, nonce, replacement fee, paymaster "underpaid"), and tell out-of-gas apart from a logic revert |
| **Fragility** | `sharedReads(frames, trace, sender)`: VERIFY frames reading storage someone else can change (e.g. a Uniswap pool's `slot0`). `diagnoseDraft` turns this into a warning |
| **Fix** | `applyPatch(draft, patch, { requote? })`. Gas patches are generic; `requote` is your paymaster's pricing. `r.sendDraft` applies fixes automatically |
| **Build** | `r.buildFrameTx({ sender, frames, nonce?, maxFeePerGas? })`, `verifyFrame`, `senderFrame`, `MODE`, `SCOPE`, `maxCostBound` |
| **Sign** | `r.sign(draft, signer)` / `signDraft(draft, signer, chainId)`. The signer is a private key, a viem `LocalAccount`, or `{ signHash }` for any other scheme (PQ, multisig). `signingHash`, `decodeDraft`, `rawTxHash` |
| **Send** | `r.send(raw, node?)` (`eth_sendFrameTransaction`, sidecar wire format), `r.sendDraft(draft, signer)` |
| **Track** | `r.watch(hash, onStage)` → stop function; `r.waitForInclusion(hash)` → receipt. Stages are pending → admitted → included, or rejected / failed / dropped |
| **Monitor** | `r.recent(limit)`: the sidecar's latest admission decisions. `r.stats(limit)` / `rejectionStats(rows)`: rejected count, senders, time span, top rules |
| **Revert reason** | `r.replay(hash)` re-runs a fresh on-chain failure on its parent block. It returns null after about 128 blocks, once ethrex has pruned that state |
| **Decode** | `errorString(revertData)`, `role(frame)`, `lookupSelectors(selectors)`. The last one is optional and tells Sourcify which selectors you looked up |
| **viem** | `publicClient.extend(frameActions({ miner, gateway }))` adds `simulateFrameTransaction`, `dryRunFrameTransaction`, `sendFrameTransaction`, `sendFrameDraft`, `waitForFrameTransaction` and `explainFrameTransaction`, using the client's transport for ethrex |
| **Errors** | `ReadmitError` has a stable `code`. Subclasses: `RpcError` (`RPC_UNREACHABLE`, `RPC_<n>`), `DryRunFailed` (with the diagnosis), `TxNotIncluded` (`TX_REJECTED` / `TX_FAILED` / `TX_DROPPED`, with the diagnosis), `WaitTimeout` |

## Recipe: pay gas in an ERC-20

`@readmit/sdk/recipes/erc20Paymaster` builds the paymaster frames for a paymaster with `quote(uint256 weiCost)`, like Readmit's staked `V4PricedPaymaster`, which prices gas from a Uniswap v4 pool. Its `requote` plugs into `applyPatch` and `sendDraft`.

```ts
import { erc20Paymaster } from '@readmit/sdk/recipes/erc20Paymaster'

const pm = erc20Paymaster(r, { token: tUSD, paymaster })
const draft = await pm.transfer(wallet, to, 1_000_000n) // 4 frames, fee quoted live
const { hash } = await r.sendDraft(draft, key, { requote: pm.requote })
```

## Limits

- The diagnosis knows this sidecar's rule names and message formats. A different ERC-8421 implementation may word its rejections differently.
- The ERC-8421 spec verdict is partial: it covers the validation budget and validation reverts only.
- `replay` only works for about 128 blocks (~13 minutes on the devnet).
- The default codec profile is `ethrex-eip8141-tracer`. Pass `profile` for another one.
- There's no ethers adapter yet. ethers users can pass a transport function and a `{ signHash }` signer.

MIT.
