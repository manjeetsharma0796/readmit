# ETHGlobal submission text (paste into the form)

**Project name:** Readmit

**Short description (under 100 characters):** See which frame of an EIP-8141 tx failed, why, and the fix. Then dry-run and resend it.

## Description
EIP-8141 frame transactions let an account's own code decide what's valid. The public mempool accepts only simple ones; the ERC-8421 alternative mempool takes the rest.

When one fails, developers are left guessing:
- a **rejected** transaction never reaches a block, so there's no block-explorer page for it;
- the alt-mempool explorer gives a rule name and a hex blob;
- a transaction can be **admitted and still fail**, with the payer charged anyway.

**Readmit is a debugger and admission simulator for frame transactions.** The EF Alt Mempool prize lists three areas. Readmit's main fit is developer tooling: an admission simulator, mempool monitoring and an SDK, which the prize names. Our staked `V4PricedPaymaster` also fits the area for ERC-20 paymasters that need "more flexible state access in … paymaster".

- **Diagnose anyone's transaction by hash.** It combines the sidecar's admission report, the ethrex receipt and per-frame gas into plain-language findings.
  - It tells out-of-gas apart from a logic revert ("raising gas won't help").
  - It shows what the payer was charged for a failure.
  - It covers 10+ rejection classes using the sidecar's own rule names and numbers: the validation gas cap (two message formats), unstaked storage reads, banned opcodes, payer solvency, nonce, replacement fee and paymaster reverts.
  - It flags transactions that depend on shared pool state.
- **Dry run before you send.** `ethrex_simulateFrameTransaction` catches "frame 3 would run out of gas" before anything is broadcast.
- **Fix & send, for your own transactions.** It applies the computed fix (gas used × 1.25, rounded up), re-quotes the fee, dry-runs again, submits, and follows the tx to included.
- **Why it reverted.** A fresh failure is replayed on its parent block to get the real revert reason. The node keeps 128 blocks, about 13 minutes.
- **Gas paid in tUSD.** Our staked `V4PricedPaymaster` prices gas from a Uniswap v4 pool during validation. The canonical mempool refuses that; the alt mempool admits it. The demo wallet holds 0 ETH.

**Proven live on chain 1337:**
| What | Tx |
|---|---|
| Paid in tUSD, admitted 24 of 24 checks, block 6,065 | `0x3fd93ca4a082d636d08fc27a8afd65b6449dda7aff6609736e8f080064724b9c` |
| Fix & send after the dry run caught "frame 3 would run out of gas", block 7,261 | `0xf09e55cfe3a53b2bf7161aba59bc912b347954e557519dd980e349ad44830d4e` |

## How it's made
- **App:** Next.js 16 as a static export, React 19 and TypeScript.
  - It runs in the browser against the devnet's ethrex RPC and the Skandha-based alt-mempool sidecar (`skandha_explorer_*`, `eth_sendFrameTransaction`). Endpoints are editable.
  - There's no backend. 4-byte decoding comes from Sourcify.
- **Frame transactions:**
  - Built and signed with `@forshtat/hegota-support` (profile `ethrex-eip8141-tracer`) and viem.
  - The sender is a plain key whose default VERIFY code checks a secp256k1 signature, so no wallet contract is needed.
- **Diagnosis engine:** pure TypeScript, with a self-check on real devnet transactions and recorded dry runs (`npm run check`).
- **Contracts:** Foundry. `V4PricedPaymaster` is built on `HegotaSupport`.
  - Frame introspection: `txparam`, `frameparam`, `framedataload`.
  - `StateLibrary.getSlot0` on the predeployed v4 PoolManager.
  - A stake forwarder to the alt mempool's staking registry.
- **Hacky bits we found:**
  - The sidecar changed its gas-cap error wording, so we parse both.
  - The public gateway runs in manual bundling, so we send through the miner sidecar.
  - ethrex keeps state for only 128 blocks.
  - Forge underestimates this devnet's state gas, so we deploy with `--skip-simulation`.

## How we used AI (ETHGlobal rule: attribution)
- We built Readmit with AI coding agents, and they wrote most of the code and docs. Claude Code worked 65 of the 75 tickets and Codex worked 1. Teammates did 4 by hand.
- The repo holds the full record. [`AGENTS.md`](https://github.com/manjeetsharma0796/readmit/blob/main/AGENTS.md) is the rules every agent followed. [`TASKS.md`](https://github.com/manjeetsharma0796/readmit/blob/main/TASKS.md) has every ticket, with the agent, the teammate who asked for it, why, and the evidence. [`docs/PRD.md`](https://github.com/manjeetsharma0796/readmit/blob/main/docs/PRD.md) is the spec.
- The team set the spec, the priorities and the design direction. A teammate approved and ran every deploy, stake and transaction, and we checked each result on the devnet.
- **History:** hacking began Thu 5 Nov. Until Fri 21:00 IST we worked in a local folder on a prototype called FrameLab. The earliest saved case, `0xe97e…`, was mined Thu 23:14 IST. The repo's first five commits (Fri 21:04) import that prototype, and every change after that is a small commit tied to a ticket. One early commit with a Claude co-author line (`c20f83e`) was amended and force-pushed; the README says so.

## Limits we state plainly
- **Devnet only.** EIP-8141 isn't on mainnet until Hegotá.
- **Spot price.** The paymaster uses the v4 spot price (`slot0`). We quote with about 7% headroom and re-quote on "underpaid"; a TWAP or guarded price is next.
- **Partial spec check.** The ERC-8421 column covers the validation budget and validation reverts only.

## Links
- Live app: https://readmit-kohl.vercel.app
- Repo: https://github.com/manjeetsharma0796/readmit
- SDK (extracted from this repo's engine on Sat 7 Nov): https://github.com/manjeetsharma0796/readmit-sdk
- Golden tx (paid in tUSD, admitted 24/24, block 6,065): https://explorer.altmempool.wtf/tx/0x3fd93ca4a082d636d08fc27a8afd65b6449dda7aff6609736e8f080064724b9c?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc
- Fix & send tx (block 7,261): https://explorer.altmempool.wtf/tx/0xf09e55cfe3a53b2bf7161aba59bc912b347954e557519dd980e349ad44830d4e?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc
- Demo video: `[ADD AFTER RECORDING]`
- Contracts and proof: README sections "Uniswap integration" and "Proof"

## Prizes to select (in this order of emphasis)
The two EF tracks count as one partner prize, so these use 2 of our 3 slots. Don't tick EF Anon-RPC, because our reads don't go through Anon-RPC.
1. **EF: Best use of the Frame Transaction Alternative Mempool.** Qualification: an admitted tx link (above) plus the code that submits it (`src/rpc.ts` `sendFrameTx`, used by the Send screen).
2. **EF: Best CROPS App.** README "CROPS" section. It's the same partner slot; EF places us in at most one.
3. **Uniswap: Build with Uniswap.** README "Uniswap integration" and `FEEDBACK.md`. **A person must also submit** https://developers.uniswap.org/hackathon-feedback with the FEEDBACK.md link.
