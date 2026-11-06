# ETHGlobal submission text (paste into the form)

Fill every `[TODO]` before submitting. Don't submit a claim we haven't shown working.

**Project name:** Readmit

**Short description (one line):** Find which frame of your EIP-8141 transaction failed and the exact number to change, then re-sign it and get it admitted. Gas is paid in tUSD through a Uniswap v4-priced paymaster.

## Description
Frame transactions (EIP-8141) let an account's own code decide what's valid. The public mempool only accepts simple ones, and the ERC-8421 alternative mempool takes the rest. When one fails, developers get a rule name and a hex blob, or worse, "admitted" followed by a failed execution that the payer still paid for.

**Readmit is "simulate and debug" for frame transactions:**
- **Diagnose any hash.** It combines the sidecar's admission report, the ethrex receipt and per-frame gas into plain-language findings.
  - It tells out-of-gas apart from a logic revert ("raising gas won't help").
  - It shows what the payer was charged for a failure.
  - It covers 10+ rejection classes, using the sidecar's own rule names and numbers: the validation gas cap (both message formats), unstaked storage reads, banned opcodes, payer solvency, nonce, replacement fee and more.
- **Dry run before you send.** `ethrex_simulateFrameTransaction` tells you "frame 3 would run out of gas, raise it to about N" before anything is broadcast.
- **Fix & send.** It applies the fix, re-signs, dry-runs again and submits to the alt-mempool gateway, then follows the tx to admitted and included.
- **Why it reverted.** For a fresh failure it replays the tx on the block before it and decodes the real revert reason.
- **Pay gas in tUSD.** Our `V4PricedPaymaster` prices gas from a Uniswap v4 pool during validation. That's allowed only in the alt mempool, and only staked. The demo wallet holds 0 ETH.

## How it's made
- **App:** Next.js 16 as a static export, React 19 and TypeScript.
  - It runs entirely in the browser against the devnet's ethrex RPC and the Skandha-based alt-mempool sidecar (`skandha_explorer_*`, `eth_sendFrameTransaction`).
  - There's no backend. 4-byte decoding comes from the Sourcify signature database.
- **Frame transactions:**
  - Built and signed with `@forshtat/hegota-support` (profile `ethrex-eip8141-tracer`) and viem.
  - The sender is a plain key whose default VERIFY code checks the secp256k1 signature, so no wallet contract is needed.
  - Our builder emits 4 frames: wallet VERIFY, paymaster VERIFY, tUSD fee transfer and the user's transfer.
- **Diagnosis engine:** a pure TypeScript module with a self-check on real devnet transactions (`npm run check`).
- **Contracts:** Foundry. `V4PricedPaymaster` is built on `HegotaSupport`, the EIP-8141 opcode helpers.
  - Frame introspection: `txparam`, `frameparam`, `framedataload`.
  - `StateLibrary.getSlot0` on the devnet's predeployed Uniswap v4 PoolManager.
  - A stake forwarder to the alt mempool's staking registry.
- **Hacky bits we found:**
  - The sidecar changed its gas-cap error wording, so we parse both.
  - ethrex keeps state for only 128 blocks, so revert-reason replay is time-limited.
  - Forge underestimates this devnet's state gas, so we deploy with `--skip-simulation`.

## Links
- Repo: https://github.com/manjeetsharma0796/readmit
- Demo video: `[TODO]`
- Admitted txs on the explorer: `[TODO from README "Proof" section]`
- Contracts: tUSD `[TODO]`, V4PricedPaymaster `[TODO]`, pool id `[TODO]`

## Prizes to select
1. **Uniswap: Build with Uniswap.** Before submitting:
   - add `FEEDBACK.md` at the repo root;
   - have a human fill in the feedback form at https://developers.uniswap.org/hackathon-feedback with the FEEDBACK.md link;
   - make sure the README's "Uniswap integration" section links to `quote()`/`getSlot0`, `SetupPool` and the V4Quoter call.
2. **EF: Best use of the Frame Transaction Alternative Mempool.** Our admitted tx link plus the code that submits it, which is Fix & send.
3. **EF: Best CROPS App.** It's the same partner slot, so EF places us in at most one. The README has a CROPS section.
