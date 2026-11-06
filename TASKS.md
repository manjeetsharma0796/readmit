# Readmit tasks

Read `AGENTS.md` §3 for the claim protocol: pull, pick, claim and push, work, done and push. Within each owner's section the order is priority order, so take the first `todo` whose dependencies are `done`.

Statuses are `todo`, `doing`, `blocked` and `done`. Edit only the ticket you claimed, and only its `status`, `agent`, `started` and `log` lines.

## Gates (IST, Fri 6 → Sat 7 Nov). These replace the times in docs/PRD.md §12.
| Time | Gate: must be true | If not |
|---|---|---|
| **22:30** | T05: one Mode A tx (our staked V4PricedPaymaster) is **admitted on the gateway** | prith starts T06 (Mode B). manjeet asks Pierre/Alex whether the gateway honours stake. |
| **00:00** | Flow B end to end: send tUSD with 0 ETH → admitted → included, shown in the UI | Cut to Flow A (diagnose) plus one admitted send. Everyone helps T22. |
| **Sat 01:00** | **Feature freeze.** Only bug fixes after this. | — |
| **Sat 03:00** | **Code freeze.** Then record the video (T41). | Stop building and record. |
| **Sat 08:00** | Submitted (T42) | — |

## Who does what (summary, status lives in each ticket)
- **manjeet (macOS):**
  - Engine: T10 → T11 → T12 → T13 → T14.
  - Then P1 work: T15, T16, T17.
  - Pitch and submission: T30.
- **prith (Linux):**
  - Contracts and infra: T01 → T02 → T03 → T04 → T05 → T07 → T08.
  - Fallback: T06.
  - Then T09.
- **esh (Windows):**
  - UI: T20 → T21 → T22 → T23 → T24.
  - Then P1 work: T25, T26.
- **Everyone:** T40, T41, T42.

---

## prith: contracts and devnet infra

### T01 · Contracts toolchain builds and fork test passes
- owner: manjeet
- status: done
- note: reassigned from prith to manjeet at 21:42 IST (prith asleep; manjeet approved). prith, check with manjeet before touching.
- agent: Claude Code on manjeet
- started: 21:55 IST
- priority: P0
- depends: none
- touches: contracts/ (lib is gitignored)
- do: Install Foundry. In `contracts/`, run `forge install uniswap/v4-core@main` (it must be @main) and `npm i @forshtat/hegota-support@0.0.1`. Then `forge build` and `forge test --fork-url https://altmempool.forshtat.com`.
- done when: `forge test` passes (`test/Quote.t.sol`). Paste the summary line into the log.
- log: Foundry 1.9.0 on macOS. v4-core@main and forge-std are installed with `forge install --no-git` (lib/ is gitignored). hegota-support is read from the repo root node_modules via a remapping plus `allow_paths`. `forge test --fork-url https://altmempool.forshtat.com`: test_quoteTracksPool PASS.

### T02 · Paymaster gets `owner` and `withdraw()`
- owner: manjeet
- status: done
- note: reassigned from prith to manjeet at 21:42 IST (prith asleep; manjeet approved). prith, check with manjeet before touching.
- agent: Claude Code on manjeet
- started: 21:55 IST
- priority: P0
- depends: T01
- touches: contracts/src/V4PricedPaymaster.sol, contracts/test/
- do: Add `address public immutable owner = msg.sender` and `withdraw(address payable to, uint256 eth, uint256 tusd)`, owner-only, so we can recover the deposit and the collected tUSD. Don't change the `fallback()` VERIFY logic.
- done when: `forge test` passes, including one new test that a non-owner `withdraw` reverts.
- log: Added `OWNER` (immutable, the deployer) and `withdraw(to, eth, tusd)`, owner-only. The VERIFY fallback is unchanged. Fork test run: 3 tests passed (test_ownerWithdraws, test_nonOwnerCannotWithdraw, test_quoteTracksPool).

### T03 · Shrink setup costs and wire the deployer key
- owner: manjeet
- status: done
- note: reassigned from prith to manjeet at 21:42 IST (prith asleep; manjeet approved). prith, check with manjeet before touching.
- agent: Claude Code on manjeet
- started: 21:55 IST
- priority: P0
- depends: T01
- touches: contracts/script/SetupPool.s.sol, contracts/.env.example
- do: Cut pool liquidity to ≤0.5 ETH and the paymaster deposit to 0.5 ETH. The key is read from `contracts/.env` as `DEPLOYER_KEY`, which is never committed; add a `.env.example`. Your human generates a fresh key and funds it from the devnet faucet (about 1.5 ETH). **Ask your human before funding.**
- done when: `forge script SetupPool --fork-url https://altmempool.forshtat.com` (dry run, no broadcast) prints SIMULATION COMPLETE, and the deployer's `cast balance` is ≥ 1.2 ETH.
- log: Liquidity cut to L=1e13 with 0.25 ETH sent (about 0.18 ETH used, the rest refunded) and a 0.3 ETH paymaster deposit, so the total need is about 0.65 ETH. A fresh deployer key `0x2f50Cb720032dA2523364943291E7543c13a285C` is in `contracts/.env` (gitignored, 0600). It was funded with 1 ETH from the explorer faucet on manjeet's approval. SetupPool now writes `contracts/deployments/1337.json` (tUSDDecimals 6). Dry run on the fork: SIMULATION COMPLETE.

### T04 · Deploy tUSD, the ETH/tUSD v4 pool and the paymaster, then stake it
- owner: manjeet
- status: done
- note: reassigned from prith to manjeet at 21:42 IST (prith asleep; manjeet approved). prith, check with manjeet before touching.
- agent: Claude Code on manjeet
- started: 21:58 IST
- priority: P0
- depends: T02, T03
- touches: contracts/deployments/1337.json, contracts/script/
- do:
  - **Ask your human first.** Run `forge script SetupPool --rpc-url https://altmempool.forshtat.com --broadcast --skip-simulation -g 105`, then `StakePaymaster` with 0.012 ETH and an 86,400 s delay.
  - Write `contracts/deployments/1337.json` in the shape given in AGENTS.md §6.
  - Re-read the predeploy addresses from the sidecar repo `deploy/predeploy/addresses/1337.json` first, and check that the PoolManager has code.
- done when: `cast code` is non-empty for tUSD and the paymaster, `quote(1e15)` returns a value > 0, and the staking registry shows the paymaster staked. Put the addresses and tx hashes in the log.
- log: Deployed on chain 1337 with 8/8 txs status 1. tUSD `0xFa85eaee2c9abF09Ec7c305692979C0Ab91D0024`, paymaster `0xc9ca898B92fA53635959021239E190Cf22c1F1d9` (owner = deployer, 0.3 ETH deposit), PoolSwapTest `0x4EE0cd5AcB8B0DbF00a537Edd765eb7Cb79fc0c9`, poolId `0x34922fed…4975`, ETH/tUSD at 1 ETH = 3000 tUSD. `quote(1e15)` = 3,299,998, i.e. 3.3 tUSD. Stake tx `0x84c42869…22a9`: registry `getDepositInfo` = 0.012 ETH, delay 86,400 s. All of this is in `contracts/deployments/1337.json`; broadcast receipts are in `contracts/broadcast/` (gitignored).

### T05 · GATE 22:30: golden Mode A tx admitted on the gateway
- owner: manjeet
- status: done
- note: reassigned from prith to manjeet at 21:42 IST (prith asleep; manjeet approved). prith, check with manjeet before touching.
- agent: Claude Code on manjeet
- started: 22:01 IST
- priority: P0
- depends: T04
- touches: contracts/script/golden.mts
- do:
  - Write one script that builds and sends a frame tx:
    1. VERIFY wallet;
    2. VERIFY `V4PricedPaymaster`;
    3. SENDER `tUSD.transfer(paymaster, quote)`;
    4. SENDER `tUSD.transfer(any, 1)`.
  - Base it on the workshop tx builder (`forshtat/mempool-workshop` `src/lib/frameTx/build.js`) and `@forshtat/hegota-support`. Send with `eth_sendFrameTransaction` to the **gateway**.
  - The wallet can be the workshop `ExampleWallet` deployed with T07's key.
  - **Ask your human before sending.**
- done when: `skandha_explorer_getTransaction` on the gateway shows `admitted` or `included`. Put the explorer link in the log.
- If it's rejected with "unstaked … accessed … slot", paste the detail into the log, set `blocked` with `needs: manjeet` (ask EF), and start T06.
- log: **GATE MET at 22:01 IST.** Golden Mode A tx `0x3fd93ca4a082d636d08fc27a8afd65b6449dda7aff6609736e8f080064724b9c`. The demo wallet (plain key, 0 ETH) sent 1 tUSD and paid 2.969998 tUSD gas to our **staked** V4PricedPaymaster, which reads the v4 pool slot0 during VERIFY. Gateway admission: 24 checks, 0 failed. The public mempool would refuse it (simulate: canonicalMempoolValid false, "StorageReadNonSender"). Included in block 6065, status 0x1, payer = paymaster, frames 100 / 52,848 / 28,461 / 18,461 gas. Afterwards the demo wallet holds 96.030002 tUSD and 0 ETH; the paymaster spent 0.000217 ETH. Explorer: https://explorer.altmempool.wtf/tx/0x3fd93ca4a082d636d08fc27a8afd65b6449dda7aff6609736e8f080064724b9c?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc . It was sent with `src/engine/frames.ts` plus `src/rpc.ts`, not a separate script. Saved as `src/samples/paid-in-tusd.json`. Lesson: the gateway is manual-bundling. The identical signed tx (same hash) was handed to the miner, which included it in 14 s. sendFrameTx now defaults to the miner. T06 (Mode B) is not needed.

### T06 · FALLBACK (only if T05 fails): Mode B swap-to-pay paymaster
- owner: prith
- status: todo
- agent:
- started:
- priority: P0 (conditional)
- depends: T05 blocked
- touches: contracts/src/SwapPayPaymaster.sol, contracts/script/, contracts/deployments/1337.json
- do: The paymaster's VERIFY checks only frame params, with no foreign storage reads:
  - frame k+1 is SENDER calling `PoolSwapTest.swap` (tUSD → ETH);
  - frame k+2 is SENDER sending ≥ MAX_COST wei to the paymaster.

  Deploy it, fund it with 0.3 ETH, and send one tx the same way as in T05.
- done when: the gateway shows the Mode B tx admitted, with its explorer link in the log. The deadline is 00:30.
- log:

### T07 · Demo wallet: 100 tUSD, 0 ETH
- owner: manjeet
- status: done
- note: reassigned from prith to manjeet at 21:42 IST (prith asleep; manjeet approved). prith, check with manjeet before touching.
- agent: Claude Code on manjeet
- started: 22:00 IST
- priority: P0
- depends: T04
- touches: contracts/script/, contracts/deployments/1337.json
- do:
  - Generate a demo key. It's test-only; give it to esh's human privately and never commit it.
  - Deploy a workshop-style `ExampleWallet` owned by that key, and transfer 100 tUSD to it.
  - Record `demoWallet` in deployments.
- done when: the wallet has code, its tUSD balance is 100e18, and its ETH balance is 0.
- log: The demo wallet is a plain key address, `0x1328e0a64F2fc445382e8FF59F4Ab727fBec5742`, with no contract (the default VERIFY code checks the signature). It got 100 tUSD (raw 100000000, 6 decimals) in tx `0xbee97973…8458`, and its ETH is 0. The key is in manjeet's `contracts/.env` as DEMO_KEY, never committed. manjeet shares it with esh privately for T21. `demoWallet` is in deployments. needs: esh. T21 can unblock: read `contracts/deployments/1337.json` (tUSD has 6 decimals; `tUSDDecimals`).

### T08 · Uniswap qualification: README section and FEEDBACK.md
- owner: manjeet
- note: reassigned from prith to manjeet at 22:14 IST (prith asleep; manjeet approved)
- status: done
- agent: Claude Code on manjeet
- started: 22:14 IST
- priority: P0
- depends: T04
- touches: FEEDBACK.md, README.md (the "Uniswap integration" section only)
- do:
  - `FEEDBACK.md`: v4 on an unsupported devnet, StateLibrary/extsload DX, no validation-time oracle, state-gas deploy pain, the v4-core tag issue.
  - README section: GitHub line links to `quote()` / `getSlot0`, to `SetupPool` `initialize` / `modifyLiquidity`, and to the V4Quoter call (T15, if it lands).
  - Also list the deployed addresses and tx hashes.
- done when: both files are on `main` and the links open on GitHub.
- log: The README "Uniswap integration" section links to code pinned at commit 8cdaa12: `quote()`/`getSlot0` (V4PricedPaymaster.sol L45-49), the VERIFY `fallback()` (L53-66), `PoolManager.initialize` (SetupPool L25-27), `modifyLiquidity` (L32), the `swap` (L67), and the app's `quote`/`buildSendTx`/`requote` plus the underpaid diagnosis. It also gives deployed addresses and creating txs, and the on-chain events were checked: Initialize in block 5,999 and ModifyLiquidity in block 6,004. The golden tUSD-paid tx is linked too. `FEEDBACK.md` covers what worked and 6 friction points with measured numbers. Logged-out curl returns 200 for every link. Still to do, by a human at 07:30: the Uniswap developer feedback form at https://developers.uniswap.org/hackathon-feedback with the FEEDBACK.md link (T42).

### T09 · Price-moved fixture (P1)
- owner: prith
- status: done
- agent: Claude Code on prith
- started: 22:15 IST
- priority: P1
- depends: T05
- touches: contracts/script/, src/samples/ (one new JSON, with manjeet's ok)
- do: Sign a tx at the current quote, run `MovePrice` once (that's 1 of the 3 allowed), then send it. VERIFY should fail as underpaid. Save the hash and the gateway report as a sample.
- done when: the rejected hash is in the log and its report JSON is in `src/samples/price-moved.json`.
- log: Script `contracts/script/priceMoved.mts` written. Read-only plan run works against the live devnet: demo nonce 1, signed fee 2.969998 tUSD, a 2% quote rise needs ~5.49 tUSD swapped into the pool. Nothing sent yet. **Waiting on:** `DEMO_KEY` and `DEPLOYER_KEY` in `contracts/.env` (manjeet's machine only; not in git), then manjeet's ok for the one MovePrice and send. needs: manjeet. Run: `node contracts/script/priceMoved.mts --go`. **Closed by manjeet at 22:31 IST, superseded.** T15 already has a real underpaid dry run (`src/samples/sim-underpaid.json`), and Readmit catches it and re-quotes. We are not running MovePrice and not sending a deliberately underpaid tx: it would move the small pool price for every later tx and could hurt paymaster reputation before the demo. Keys are not shared. Keep `contracts/script/priceMoved.mts` for later; don't run it.

---

## manjeet: engine, then pitch and submission

### T00 · Migrate the app from Vite to Next.js (static export)
- owner: manjeet
- status: done
- agent: Claude Code on manjeet
- started: 21:19 IST
- priority: P0
- depends: none
- touches: package.json, package-lock.json, next.config.ts, tsconfig*.json, src/app/, src/main.tsx (deleted), index.html (deleted), vite.config.ts (deleted), src/index.css (moved to src/app/globals.css), .gitignore
- do: Switch to the Next.js App Router with `output: "export"`, so the app stays static with no server and the CROPS promise holds. The page is client-only. The UI stays unchanged.
- done when: `npm run build` produces `out/`, `npm run dev` serves http://localhost:5173 with the same UI, and `npm run check` passes.
- log: next@16.4.5. `npm run build` exports to out/ (static, 2 routes); `npm run check` passes 4 cases; dev server on :5173 renders the same UI at 1280 and 375 px with no new console errors; fonts are self-hosted via next/font (no Google requests). Run `npm install` after pulling.

### T10 · Classify failed frames correctly
- owner: manjeet
- status: done
- agent: Claude Code on manjeet
- started: 21:17 IST
- priority: P0
- depends: none
- touches: src/diagnose.ts, src/diagnose.check.ts, src/samples/
- do: Classify each failed frame as **out of gas** (≥98% of its limit), **logic revert** (below 98%; the text must say "raising gas won't help"), or **skipped** (status 0x2), plus "payer charged anyway". Add tx `0x6137f039a0b152e5b1d20be99abd3f3a1a24891cd4f30fcc22ad9b59f7a93c75` as a sample. It's a logic revert: frame 2 used 8,158 of 50,000.
- done when: `node src/diagnose.check.ts` passes with ≥5 cases, including the 0x6137 logic revert.
- log: `npm run check` → "diagnose: 6 cases OK" (adds the real 0x6137 logic revert and a skipped-frame case). Live check in the UI for 0x6137: "Frame 2 reverted (not a gas problem), 8,158 of its 50,000 gas limit (16.3%)", plus the payer charged 0.000482 ETH and "No admission report". `npm run build` passes. needs: esh. Add a "Logic revert" sample chip for `src/samples/logic-revert.json` in App.tsx during T20.

### T11 · Correct advice and parse thresholds
- owner: manjeet
- status: done
- agent: Claude Code on manjeet
- started: 21:23 IST
- priority: P0
- depends: T10
- touches: src/diagnose.ts, src/diagnose.check.ts
- do:
  - Remove "or stake" from the verify-gas fix. The sidecar caps 100k for every account, staked or not; mention ERC-8421 BUDGET-010 only as "the spec says".
  - Take the numbers from the detail text, never hardcode them.
  - Use the sidecar's rule names.
  - For an unknown rule, show its detail verbatim.
  - Add the classes "payer can't cover cost", "unstaked foreign storage read" and "banned opcode" (PRD §11).
- done when: the self-check passes, and a grep for "or stake" in `src/` returns nothing.
- log: `npm run check` gives "diagnose: 12 cases OK", with 6 new real samples from the gateway and miner. The cap fix no longer says "stake". It also handles the newer cap wording "prefix gas budget exceeded: N > N (MAX_VERIFY_GAS)", which the old parser missed (6 recent hits). New classes: state-gas cap, payer can't cover max cost, validation out of gas, unstaked storage read (stake advice is correct here), banned opcode, wrong nonce, already known. Every finding names the sidecar rule, and all numbers come from the detail text. When several rules fail, the spec column keeps the most severe. Zero "or stake" matches remain in src/. Live UI check on 0x5c67…dafd4 (miner) showed both findings, with the spec verdict "Also invalid". `npm run build` passes.

### T12 · Frame tx builder and signer (`src/engine/frames.ts`)
- owner: manjeet
- status: done
- agent: Claude Code on manjeet
- started: 21:26 IST
- priority: P0
- depends: T10 (stub the addresses until T04 is done)
- touches: src/engine/frames.ts, src/engine/frames.check.ts, package.json (add `@forshtat/hegota-support`)
- do: Implement `buildSendTx` and `signDraft` as given in AGENTS.md §6. The Flow B frames are:
  1. VERIFY wallet (approve execution);
  2. VERIFY paymaster (approve payment);
  3. SENDER `tUSD.transfer(paymaster, quote)`;
  4. SENDER `tUSD.transfer(to, amount)`.

  Read `quote` from the paymaster with `eth_call`. Get the sig hash and encoding from hegota-support; the profile is `ethrex-eip8141-tracer`.
- done when: `frames.check.ts` builds a draft, signs it, and decodes it back to 4 frames with the same fields. After T04, a dry run of it via T13 succeeds.
- log: `src/engine/frames.ts` is built on @forshtat/hegota-support@0.0.1 and viem@2.57.0, with no new code beyond what the interface needs. `npm run check` prints "frames: build/sign/decode OK": 4 frames round-trip with the same fields, and Fix & send re-sign changes only the edited frame. Live read-only simulate of a builder draft returned prefixShape SelfVerify and halted only on insufficient_funds (the key was unfunded), so the devnet accepts the encoding. Overhead above the limits measured 16,826 gas; the bound uses 50k. The AGENTS.md §6 interface is updated: signDraft is async and buildSendTx takes {tUSD, paymaster}. needs: prith. **T07 doesn't need a wallet contract.** The demo wallet is a plain key address (default VERIFY code checks the signature), so just send it 100 tUSD.

### T13 · Dry run (simulate) adapter
- owner: manjeet
- status: done
- agent: Claude Code on manjeet
- started: 21:29 IST
- priority: P0
- depends: T12
- touches: src/rpc.ts, src/diagnose.ts
- do: Implement `simulate(rawTx)` using `ethrex_simulateFrameTransaction [raw, "latest", {trace:true}]` on the ethrex RPC. Map the result into the same findings as a receipt, so `diagnose` works on a draft before it's sent.
- done when: a draft with frame 3's gas set too low shows "Frame 3 would run out of gas, raise to N" without sending anything.
- log: `simulate(raw)` is in `src/rpc.ts`. `diagnoseDraft(draftFrames(d), sim)` is in `src/diagnose.ts`, and receipt and dry-run findings now share one classifier (`execFindings`, "did" or "would" wording). `npm run check` prints "diagnose: 16 cases OK". That includes a real recorded simulate response (unfunded key, "payer can't cover"), plus would-OOG giving "Frame 4 would run out of gas, raise to about 38,000 before sending", would-revert and ready-to-send, all in the simulator's documented shape. The receipt UI still renders the same (checked on the OOG sample). **Not yet checked live:** the execution path needs a funded wallet and the deployed paymaster (T04/T07). It gets re-checked during T22's real send.

### T14 · Send and watch status
- owner: manjeet
- status: done
- agent: Claude Code on manjeet
- started: 21:32 IST
- priority: P0
- depends: T13
- touches: src/rpc.ts
- do: `sendFrameTx(raw)` uses `eth_sendFrameTransaction` on the **gateway**. `watchTx(hash, cb)` polls `skandha_explorer_getTransaction` every 2 s, then the receipt, and goes pending → admitted/rejected → included/failed. Stop after 120 s.
- done when: one real send of a T12 draft (**ask your human first**) reports admitted, then included. The hash goes in the log.
- log: The code is done in `src/rpc.ts`: `sendFrameTx` (wire format via hegota-support `toWire`, same as the workshop golden script), plus `watchTx` and `txStage`. The status mapping uses the sidecar explorer's mempool statuses (New/Pending/Submitted = admitted, OnChain/Finalized = included, Reverted = failed, Cancelled = dropped). `npm run check` prints "rpc: send-status mapping OK" on real samples, and the build passes. **Blocked:** the done-check needs one real send. That needs manjeet's go-ahead (AGENTS §5) and a funded wallet. needs: prith (T04 paymaster plus T07 demo key with tUSD), then manjeet approves one send. **Unblocked and verified live at 22:01** with manjeet's approved send: `0x3fd93ca4a082d636d08fc27a8afd65b6449dda7aff6609736e8f080064724b9c` went admitted (0 s), then included (14 s) on the miner via `watchTx`. Default node is now the miner (gateway = manual bundling).

### T15 · Uniswap re-quote fix (P1)
- owner: manjeet
- status: done
- agent: Claude Code on manjeet
- started: 22:10 IST
- priority: P1
- depends: T14
- touches: src/engine/, src/diagnose.ts
- do: When the paymaster VERIFY fails as underpaid, re-read the price (paymaster `quote()`, or V4Quoter `0xeEa49CC6419125E2f706bf7f95Cf34ac7e93087D`) and set the fix to "pay X tUSD". Fix & send then uses the new amount.
- done when: T09's sample shows the re-quoted amount, and a resend with it is admitted.
- log: The diagnosis now decodes Error(string) reverts, so the paymaster's require messages become plain findings: underpaid, sender lacks tUSD, and a wrong or missing fee frame. That works for both admission reports and dry runs. Findings carry a machine-readable `patch` (`{kind:'gas',frame,gas}` or `{kind:'requote'}`). `frames.ts` adds `requote(draft, addrs)` and `applyPatch(draft, patch, addrs)`; both keep the nonce. Live read-only check on chain 1337: a draft paying 10% under today's quote showed "Wouldn't run: The tUSD fee is below the paymaster's price". `applyPatch` re-quoted 2.488597 to 2.969998 tUSD, then the dry run said "Would succeed, Ready to send". The real underpaid dry run is saved as `src/samples/sim-underpaid.json`. `npm run check` prints "diagnose: 20 cases OK". Finding: the builder already quotes with about 7.4% headroom (the overhead slack), so small price moves don't fail. A real resend of a fixed tx waits for the T40 demo run, which needs one more approved send. needs: esh. For T23 Fix & send: `const d2 = await applyPatch(draft, finding.patch, addrs)`, then `signDraft`, `simulate`, `sendFrameTx`.

### T16 · "Why did it revert" spike (P1, 20 minute cap)
- owner: manjeet
- status: done
- agent: Claude Code on manjeet
- started: 21:33 IST
- priority: P1
- depends: T13
- touches: src/rpc.ts, src/diagnose.ts
- do: Try `ethrex_simulateFrameTransaction` with the parent block number instead of "latest" for an included tx, to get `revertData`, then decode it. If it doesn't work within 20 minutes, set `done` with "not supported" in the log.
- done when: 0x6137 shows a revert reason, or the log says it isn't supported.
- log: It works, but only for recent txs. `replay(hash)` is in `src/engine/frames.ts`. It rebuilds the exact tx bytes from `eth_getTransactionByHash` (`eth_getRawTransactionByHash` doesn't exist; the rebuilt hash matched 0x6137 exactly) and simulates at the parent block, which gives `failedFrameIndex` and `revertData`. ethrex keeps state for only 128 blocks, measured at 6.0 s/block, so about 13 minutes. head−127 works and head−129 returns "state root missing". For 0x6137 the state is pruned, so `replay` returns null; the unknown-hash case also returns null. The success path wasn't seen live, because no reverted tx fell inside the window. needs: esh. In T22 or T23, call `replay(hash)` as soon as `watchTx` reports `failed`, and show the decoded `revertData` (`lookupSelectors`) on the failed frame's card. **It must happen within ~13 minutes.**

### T17 · Fragility flag (P1)
- owner: prith
- note: reassigned from manjeet to prith at 22:31 IST (manjeet approved). prith may edit src/diagnose.ts and src/diagnose.check.ts for this ticket only. No keys are needed: use the fixture below.
- status: done
- agent: Claude Code on prith
- started: 22:45 IST
- priority: P1
- depends: T13
- touches: src/diagnose.ts, src/diagnose.check.ts, src/samples/sim-trace-paymaster.json (read only)
- do: Use the fixture `src/samples/sim-trace-paymaster.json`, a real read-only dry run with trace. In its `sim.erc7562Trace`, frame 1 (the paymaster VERIFY) has a STATICCALL to the v4 PoolManager `0x6bF9…9848` with 1 storage read (slot0, shared and mutable) and a STATICCALL to tUSD with 1 read (the sender's balance, sender-associated, fine). Flag only reads of contracts that are neither the sender, nor the frame target, nor a sender-associated token slot. Ignore the hegota-support helper contracts (calls with no reads). Add `diagnoseDraft` support via an optional trace argument. If the simulation trace shows a VERIFY frame reading storage of a shared contract (the v4 PoolManager), add a warning finding: "This tx depends on the pool price; a swap can invalidate it before inclusion."
- done when: our Mode A draft shows the warning.
- log: `npm run check` -> "diagnose: 21 cases OK / frames: build/sign/decode OK / rpc: send-status mapping OK"; tsc --noEmit and oxlint clean. `diagnoseDraft(frames, sim, { sender, trace? })` (trace defaults to `sim.erc7562Trace`) adds a warn finding on frame 1 of `sim-trace-paymaster`: reads of PoolManager 0x6bf9…9848 are flagged; the tUSD read is sender-associated (keccak preimage sender||0) and is not flagged; reads by the sender and frame target, and helper calls with no reads, are ignored. Without a sender or trace, behaviour is unchanged. needs: esh. The UI is not wired yet: `src/ui/Send.tsx` must call `simulate(raw, true)` and pass `{ sender: draft.sender }` to show the warning (I didn't touch that file).

### T30 · Pitch, video script and submission text
- owner: manjeet
- status: doing
- agent: Claude Code on manjeet
- started: 21:35 IST
- priority: P0
- depends: none (finalise after 01:00)
- touches: docs/PITCH.md, docs/SUBMISSION.md
- do: A 90-second demo script following PRD §7:
  1. 0xe97e: admitted but failed.
  2. 0x6137: the explorer can't say why.
  3. Our own send fails, then Fix & send, then admitted, paid in tUSD with 0 ETH.

  Also write the ETHGlobal submission text (description, how it's made, tracks), plus answers for "why the alt mempool" and "why Uniswap".
- done when: both docs are on `main` and the script reads out in under 3 minutes.
- log: First drafts are on main: `docs/PITCH.md` (a 90 s script built on the real 0xe97e and 0x6137 cases, plus judge Q&A) and `docs/SUBMISSION.md` (form text and prize checklist). They read under 3 minutes. Every hash, address and number that doesn't exist yet is marked `[TODO]` and gets filled after T05, T22 and T40. Status stays `doing` until those are filled after 01:00.

---

## esh: UI (Windows)

### T20 · Rename to Readmit and use the familiar tx-page layout
- owner: esh
- status: done
- note: wait for T00 (Next.js migration) to be done, then pull before starting
- agent: Claude Code on esh
- started: 21:30 IST
- priority: P0
- depends: none
- touches: src/App.tsx, src/app/globals.css, src/app/layout.tsx (title), src/ui/
- do:
  - Replace "FrameLab" everywhere in the UI: the wordmark and the `<title>`.
  - Lay the result out like an Etherscan tx page:
    - a header with the hash, a status badge, block, payer and fee;
    - a "What to change" panel first;
    - a frames **table** with columns #, role, target, call, gas used / limit with a bar, and status, where the failed row is red;
    - admission checks under "Technical details", collapsed.
  - Keep all current data. Plain words only.
- done when: you've looked at the screenshots at 1280 px and 375 px, the console has no errors, the "Ran out of gas" sample shows frame 4 as a red row, and `npm run build` passes.
- log: Overview rows (hash, status badge, block, sender, payer, fee, 3 verdicts) → "What to change" panel → frames table (#, role, target, call, gas used/limit with bar, status) → "Technical details" collapsed. "Ran out of gas" sample: frame 4 row red, "29,925 / 30,000 · Ran out of gas". Checked at 1280 and 375 px via DOM (no horizontal overflow, table stacks on mobile) plus a 375 px screenshot; full 1280 px screenshots timed out in the pane. Console: no errors. Added the "Logic revert" chip (from T10). `npm run build` passes, `npm run check` passes.

### T21 · Wallet panel
- owner: esh
- status: done
- agent: Claude Code on esh
- started: 21:37 IST
- priority: P0
- depends: none (stub until T07; `// stub:`)
- touches: src/ui/Wallet.tsx, src/App.tsx (mount only)
- do:
  - Add an "Import demo key" field. The key is stored in localStorage on this device only.
  - Show the wallet address (from `contracts/deployments/1337.json` `demoWallet`), the tUSD balance (`balanceOf` via `eth_call`) and the ETH balance, which should be 0.
  - Add a short "test key, devnet only" note.
- done when: after T07, the real wallet shows 100 tUSD and 0 ETH.
- log: UI done in `src/ui/Wallet.tsx`, mounted in App.tsx: "Import demo key" (password field, 0x+64 hex check, localStorage `readmit.demoKey` only, Forget key), signer address, wallet address, tUSD (`balanceOf` via `eth_call`) and ETH balance, "test key, devnet only" note. Addresses are a `// stub:` until T07 writes `contracts/deployments/1337.json`, so it shows "Not deployed yet". Checked at 1280 and 375 px, console clean, `npm run build` passes. Also edited src/app/globals.css (wallet styles). **Blocked:** the done-check needs the real demo wallet. needs: prith (T07), then swap the stub for the deployments import. 22:55 unblocked: the stub is replaced by `contracts/deployments/1337.json` (src/ui/deploy.ts). Live: wallet 0x1328…5742 shows 96.030002 tUSD and 0 ETH (100 minus the golden/demo sends; tUSD has 6 decimals). Console clean, build passes.

### T22 · Send screen (Flow B)
- owner: esh
- status: blocked
- agent: Claude Code on esh
- started: 21:39 IST
- priority: P0
- depends: T21 (UI against stubs first), then T12, T13 and T14 for the real thing
- touches: src/ui/Send.tsx, src/App.tsx (mount only)
- do:
  - Recipient and amount fields with one **Send** button.
  - Steps shown as a timeline: Checking (dry run) → Signing → Sent → Admitted → Included, with an explorer link.
  - Show the fee: "Gas paid: X tUSD, ETH used: 0".
  - Errors in plain words, with next steps: dry-run failure, which shows the diagnosis; rejected; timeout.
- done when: a real send from the demo wallet reaches Included in the UI. Put the hash in the log.
- log: UI done in `src/ui/Send.tsx`, mounted in App.tsx. Recipient + amount + one Send button. Flow: `buildSendTx` → sign → `simulate` → `diagnoseDraft` (stops and shows the findings if anything fails or warns) → sign → `sendFrameTx` → `watchTx`. Timeline: Checking (dry run) → Signing → Sent → Admitted → Included, explorer link, "Gas paid: X tUSD, ETH used: 0" (fee read from the fee frame). Plain-word errors with next steps: no key, not deployed, bad address/amount, dry-run failure, rejected, failed on chain, dropped, 2-minute timeout, devnet unreachable. Moved the deployments stub to `src/ui/deploy.ts` (shared with Wallet.tsx); also edited src/app/globals.css. Checked at 1280 and 375 px, console clean, `npm run build` passes. Timeline not yet seen live. **Blocked:** a real send needs tUSD + paymaster deployed and a funded key. needs: prith (T04, T07), then esh approves one send. 22:55 deployments wired (real tUSD/paymaster, 6 decimals). Still blocked only on the real send: esh needs the demo key (DEMO_KEY, from manjeet privately) and must approve the send. Handover (esh): manjeet runs the live sends with DEMO_KEY (esh approves this). needs: manjeet. Steps: `npm run dev`, import the key in the wallet panel, Send 1 tUSD; then tick "Send with low gas (demo)", Send, "Send anyway", then Fix & send. Put the hashes here and set done.

### T23 · Fix & send
- owner: esh
- status: blocked
- agent: Claude Code on esh
- started: 22:49 IST
- priority: P0
- depends: T22
- touches: src/ui/Send.tsx, src/ui/FixAndSend.tsx
- do:
  - Add a "Send with low gas (demo)" toggle that sets the last frame's gas too low.
  - When the dry run or receipt reports out of gas, show the fix and a **Fix & send** button. It applies the new limit, re-runs the dry run and sends.
  - Show the old hash ❌ next to the new hash ✅.
- done when: one live round trip is recorded in the log, with the failed or caught draft and the admitted hash.
- log: Code done: `src/ui/FixAndSend.tsx` + `src/ui/Send.tsx`. "Send with low gas (demo)" sets the last frame to 20,000 gas. If the dry run reports out of gas, it shows the fix and **Fix & send**, plus "Send anyway (demo)" to get a real on-chain failure; a failed receipt is diagnosed the same way. Fix & send rebuilds with a fresh nonce, applies the finding's gas patch (`applyPatch`), re-quotes the fee (`requote`, since the higher limit raises max cost), re-runs the dry run and sends. Shows ❌ old hash (or "caught by the dry run") next to ✅ new hash. Build and `npm run check` (21 cases) pass, page loads with a clean console. Started before T22 was done (T22 code is complete; only its live send is missing). **Blocked:** the live round trip needs the demo key in esh's browser and esh's OK to send. needs: manjeet (send DEMO_KEY to esh privately). Handover (esh): manjeet runs the live sends with DEMO_KEY (esh approves this). needs: manjeet. Steps: `npm run dev`, import the key in the wallet panel, Send 1 tUSD; then tick "Send with low gas (demo)", Send, "Send anyway", then Fix & send. Put the hashes here and set done.

### T24 · CROPS section in README
- owner: esh
- status: done
- agent: Claude Code on esh
- started: 21:25 IST
- priority: P0
- depends: none
- touches: README.md (the "CROPS" section only)
- do:
  - Add a section titled **CROPS** with one or two lines per letter:
    - **C (lead):** if one mempool refuses your tx, Readmit shows why and gets it in through another. It's a static app with no server and works with any RPC.
    - **O:** MIT, and it builds from this repo.
    - **P:** no trackers; the Nox Anon-RPC toggle (T25), if it lands.
    - **S:** keys stay in the browser and are test-only; every send is dry-run first.
  - State the trade-offs.
- done when: the section is on `main`.
- log: 21:25 README.md has a "## CROPS" section (C/O/P/S + trade-offs) on main. P line leaves out Nox (T25 not started); add it if T25 lands. S line assumes the T13 dry run ships; revise if it is cut.

### T25 · Nox Anon-RPC toggle (P1)
- owner: esh
- status: todo
- agent:
- started:
- priority: P1
- depends: T22
- touches: src/net/nox.ts (new), src/ui/ (toggle). For the one-line hook in `src/rpc.ts`, ask manjeet first.
- do: Add a toggle that routes reads and sends through `@anon-rpc/browser-harness` (Nox). Show "Same verdict via Nox".
- done when: one diagnosis works with the toggle on.
- log:

### T26 · Mobile and accessibility pass, plus README screenshots (P1)
- owner: esh
- status: done
- agent: Claude Code on esh
- started: 23:35 IST
- priority: P1
- depends: T23
- touches: src/app/globals.css, docs/img/
- do: Check that 375 px works, focus is visible, contrast is OK and there are no trackers in the network tab. Save 3 screenshots for the README.
- done when: the screenshots are in `docs/img/`.
- log: 375/390 px: no horizontal overflow, the frames table stacks, and on phones "What to change" now comes right after the title. Focus outline is visible on every control (:focus-visible). Contrast: an automated WCAG AA check found no text below 4.5:1 (3:1 for large text). Every input and button has a label. Network: only localhost, the devnet RPCs and api.4byte.sourcify.dev, so no trackers. Screenshots from the production build in docs/img/ (diagnosis.png, logic-revert.png, mobile.png). Also edited README.md (a short "Screenshots" section above "Run"). A send/Fix & send screenshot can be added after manjeet's live run.

---

## Everyone

### T40 · Full live demo run (01:00–03:00)
- owner: anyone
- status: todo
- agent:
- started:
- priority: P0
- depends: T23, T05 or T06
- touches: README.md (the "Proof" section)
- do: Run the 90-second script on the live devnet from a clean browser. Record every hash (golden, send, fix and resend) with explorer links in a README "Proof" section. Record a backup screen capture.
- done when: the README has ≥3 admitted hashes of ours.
- log:

### T41 · Record the demo video (03:00–04:00)
- owner: anyone
- status: todo
- agent:
- started:
- priority: P0
- depends: T40
- touches: none (the video file is not committed)
- do: Record a video of ≤3 minutes from T30's script.
- done when: the video plays and shows Fix & send admitted and gas paid in tUSD.
- log:

### T42 · Submit (by 08:00)
- owner: manjeet
- status: todo
- agent:
- started:
- priority: P0
- depends: T41
- touches: none
- do:
  - On the ETHGlobal submission, select **Uniswap**, **EF Alt Mempool** and **EF CROPS**.
  - A human fills in the Uniswap feedback form with the FEEDBACK.md link.
  - At 07:00, check the devnet still has our txs. If it was reset, re-run the T04/T05 scripts and update the hashes.
- done when: the dashboard shows the submission as submitted.
- log:

### T43 · Block AI attribution in commit messages
- owner: manjeet
- status: done
- agent: Claude Code on manjeet
- started: 22:20 IST
- priority: P0
- depends: none
- touches: .githooks/commit-msg, package.json (prepare), AGENTS.md §4
- do: Commit c20f83e ("T09: claim") reached main with `Co-Authored-By: Claude Sonnet 5.5`. Add a commit-msg hook that rejects AI co-author and "Generated with" lines, and install it on every machine through `npm install`.
- done when: the hook rejects that exact line and accepts normal and human co-author messages.
- log: 9 of 9 cases correct: Claude, lowercase, "Generated with Claude Code", Copilot and Cursor are blocked; normal messages, a Uniswap mention, a human co-author and the word "claim" are allowed. A real `git commit` with prith's line was rejected. The old commit c20f83e stays, because history is never rewritten (§4). needs: esh, prith. Run `npm install` after pulling to switch the hook on.

### T44 · Apply the approved Readmit logo
- owner: esh
- status: done
- agent: Codex on esh
- started: 23:30 IST
- priority: P1
- depends: none
- touches: src/App.tsx, src/app/globals.css, public/logo.svg, public/favicon.svg
- do: Replace the header mark and favicon with the approved sculpted sweep. Local changes only; no commits or pushes.
- done when: build passes and the logo renders at 1280 px and 375 px without console errors.
- log: Header mark (inline SVG, 48 px, currentColor) and favicon replaced with the approved sculpted sweep; source in public/logo.svg. Favicon turns white in dark browser themes. `npm run build` passes; checked at 1280 and 375 px with no horizontal overflow and no console errors.

### T45 · Demo-path polish: saved-case fallback, dry-run verdicts, sponsor lines
- owner: esh
- status: done
- agent: Claude Code on esh
- started: 23:35 IST
- priority: P0
- depends: T22, T17
- touches: src/App.tsx, src/ui/Send.tsx, src/app/globals.css
- do:
  - Pasting a demo hash (0xe97e…, 0x6137…) the node has forgotten falls back to the saved real case, labelled as saved. "Not found" no longer says "couldn't reach the devnet".
  - The send dry run requests the trace and passes the sender, so T17's pool-price warning shows (needs: esh from T17). Show the dry run's two verdicts (public mempool vs alt mempool, would-succeed) even when it goes on to send.
  - Fee line names where the price comes from: the paymaster's quote from the Uniswap v4 ETH/tUSD pool.
- done when: pasting 0xe97e… shows the saved case, the dry-run verdicts render, and `npm run build` passes.
- log: Pasting 0x6137… (and any saved case) when the node no longer has it now loads the saved real case labelled "Saved sample, not fetched live" (checked live: gateway returned "not found"); "not found" no longer reads as "couldn't reach the devnet". Send's dry run calls `simulate(raw, true)` with `{ sender }`, so T17's pool-price warning shows, and a "Dry run" box shows the mempool and execution verdicts plus any warnings while it sends. Fee line: "… ETH used: 0 · priced live by our paymaster from the Uniswap v4 ETH/tUSD pool". Build and `npm run check` pass. The dry-run box is first seen live in manjeet's T22/T23 sends.

## From the judge red-team and novelty check (23:40 IST)
Novelty: the debugger, ERC-8421 rule names and Fix & send are new. A Uniswap-v4-priced paymaster on this devnet already exists at this event (FrameGas), so lead with EF Alt Mempool and keep Uniswap as the supporting story. Biggest judge risk: "a nicer explorer, not a product".

### T46 · Rejection-case gallery
- owner: esh
- status: done
- agent: Claude Code on esh
- started: 23:43 IST
- priority: P0
- depends: none
- touches: src/App.tsx, src/app/globals.css
- do: Show every saved real case (12) as buttons, grouped "Rejected by the mempool", "Failed on chain" and "Worked", so an EF judge sees the coverage in 20 seconds.
- done when: all 12 cases load from the page, and `npm run build` passes.
- log: 12 saved real cases as buttons in 3 groups: Rejected by the mempool (9: cap, cap newer wording, validation out of gas, bad signature, payer can't cover, unstaked storage + opcode, banned opcode, wrong nonce, replacement fee), Failed on chain (2), Worked (1: paid in tUSD). Clicked all 12: each loads with its recorded node (5 are miner) and a matching top finding. Build passes.

### T47 · Live rejection stats from the devnet
- owner: esh
- status: todo
- agent:
- started:
- priority: P1
- depends: none
- touches: src/App.tsx, src/app/globals.css
- do: Count the node's recent rejected transactions by rule (from `skandha_explorer_listAdmissions`, which the page already reads). Show "N of the last M transactions on this node were rejected", with the top rules. This is demand evidence: other teams hit these errors this weekend.
- done when: the stats show live numbers, and `npm run build` passes.
- log:

### T48 · CROPS footer
- owner: esh
- status: done
- agent: Claude Code on esh
- started: 23:50 IST
- priority: P1
- depends: none
- touches: src/App.tsx
- do: Footer states MIT licence, static app with no backend, no trackers, keys stay in the browser, and links the repo.
- done when: the footer is on main.
- log: Footer: static site with no backend, no trackers, self-hosted fonts, demo keys stay in the browser (devnet only), every send dry-run first ("Send anyway" only appears after a dry run), and an "Open source (MIT)" repo link. Replaced the old footer line saying the app uses no keys, which stopped being true with the wallet panel. Also edited src/app/globals.css (one footer spacing rule). Build passes.

### T49 · Pitch fixes from the red-team
- owner: manjeet
- status: todo
- agent:
- started:
- priority: P0
- depends: T30
- touches: docs/PITCH.md, docs/SUBMISSION.md
- do:
  - Say "the number to change", not "the exact number": the gas suggestion is used × 1.25, rounded up.
  - Re-signing works on your own transactions; diagnosis works on anyone's. The one-line pitch must not imply otherwise.
  - Name the `slot0` spot-price limitation before a Uniswap judge does (TWAP or oracle hook is next; already in FEEDBACK.md).
  - Open with the gap: rejected frame transactions never reach a block explorer, so Readmit is the only place you see why.
  - Lead with EF Alt Mempool; FrameGas (same event) already does a Uniswap-priced paymaster.
- done when: PITCH.md and SUBMISSION.md reflect these.
- log: needs: manjeet (raised by esh).

### T50 · Editable RPC endpoints (P1, CROPS)
- owner: manjeet
- status: todo
- agent:
- started:
- priority: P1
- depends: none
- touches: src/rpc.ts, src/ui/ (settings field, with esh)
- do: Let the user point Readmit at their own ethrex RPC and sidecar, so it doesn't depend on our endpoints. Only if time allows after the freeze rules; otherwise list it under "Not built yet".
- done when: a changed endpoint is used for reads and sends.
- log: needs: manjeet (rpc.ts is manjeet's).
