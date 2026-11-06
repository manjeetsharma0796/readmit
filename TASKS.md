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
- owner: prith
- status: todo
- agent:
- started:
- priority: P0
- depends: none
- touches: contracts/ (lib is gitignored)
- do: Install Foundry. In `contracts/`, run `forge install uniswap/v4-core@main` (it must be @main) and `npm i @forshtat/hegota-support@0.0.1`. Then `forge build` and `forge test --fork-url https://altmempool.forshtat.com`.
- done when: `forge test` passes (`test/Quote.t.sol`). Paste the summary line into the log.
- log:

### T02 · Paymaster gets `owner` and `withdraw()`
- owner: prith
- status: todo
- agent:
- started:
- priority: P0
- depends: T01
- touches: contracts/src/V4PricedPaymaster.sol, contracts/test/
- do: Add `address public immutable owner = msg.sender` and `withdraw(address payable to, uint256 eth, uint256 tusd)`, owner-only, so we can recover the deposit and the collected tUSD. Don't change the `fallback()` VERIFY logic.
- done when: `forge test` passes, including one new test that a non-owner `withdraw` reverts.
- log:

### T03 · Shrink setup costs and wire the deployer key
- owner: prith
- status: todo
- agent:
- started:
- priority: P0
- depends: T01
- touches: contracts/script/SetupPool.s.sol, contracts/.env.example
- do: Cut pool liquidity to ≤0.5 ETH and the paymaster deposit to 0.5 ETH. The key is read from `contracts/.env` as `DEPLOYER_KEY`, which is never committed; add a `.env.example`. Your human generates a fresh key and funds it from the devnet faucet (about 1.5 ETH). **Ask your human before funding.**
- done when: `forge script SetupPool --fork-url https://altmempool.forshtat.com` (dry run, no broadcast) prints SIMULATION COMPLETE, and the deployer's `cast balance` is ≥ 1.2 ETH.
- log:

### T04 · Deploy tUSD, the ETH/tUSD v4 pool and the paymaster, then stake it
- owner: prith
- status: todo
- agent:
- started:
- priority: P0
- depends: T02, T03
- touches: contracts/deployments/1337.json, contracts/script/
- do:
  - **Ask your human first.** Run `forge script SetupPool --rpc-url https://altmempool.forshtat.com --broadcast --skip-simulation -g 105`, then `StakePaymaster` with 0.012 ETH and an 86,400 s delay.
  - Write `contracts/deployments/1337.json` in the shape given in AGENTS.md §6.
  - Re-read the predeploy addresses from the sidecar repo `deploy/predeploy/addresses/1337.json` first, and check that the PoolManager has code.
- done when: `cast code` is non-empty for tUSD and the paymaster, `quote(1e15)` returns a value > 0, and the staking registry shows the paymaster staked. Put the addresses and tx hashes in the log.
- log:

### T05 · GATE 22:30: golden Mode A tx admitted on the gateway
- owner: prith
- status: todo
- agent:
- started:
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
- log:

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
- owner: prith
- status: todo
- agent:
- started:
- priority: P0
- depends: T04
- touches: contracts/script/, contracts/deployments/1337.json
- do:
  - Generate a demo key. It's test-only; give it to esh's human privately and never commit it.
  - Deploy a workshop-style `ExampleWallet` owned by that key, and transfer 100 tUSD to it.
  - Record `demoWallet` in deployments.
- done when: the wallet has code, its tUSD balance is 100e18, and its ETH balance is 0.
- log:

### T08 · Uniswap qualification: README section and FEEDBACK.md
- owner: prith
- status: todo
- agent:
- started:
- priority: P0
- depends: T04
- touches: FEEDBACK.md, README.md (the "Uniswap integration" section only)
- do:
  - `FEEDBACK.md`: v4 on an unsupported devnet, StateLibrary/extsload DX, no validation-time oracle, state-gas deploy pain, the v4-core tag issue.
  - README section: GitHub line links to `quote()` / `getSlot0`, to `SetupPool` `initialize` / `modifyLiquidity`, and to the V4Quoter call (T15, if it lands).
  - Also list the deployed addresses and tx hashes.
- done when: both files are on `main` and the links open on GitHub.
- log:

### T09 · Price-moved fixture (P1)
- owner: prith
- status: todo
- agent:
- started:
- priority: P1
- depends: T05
- touches: contracts/script/, src/samples/ (one new JSON, with manjeet's ok)
- do: Sign a tx at the current quote, run `MovePrice` once (that's 1 of the 3 allowed), then send it. VERIFY should fail as underpaid. Save the hash and the gateway report as a sample.
- done when: the rejected hash is in the log and its report JSON is in `src/samples/price-moved.json`.
- log:

---

## manjeet: engine, then pitch and submission

### T00 · Migrate the app from Vite to Next.js (static export)
- owner: manjeet
- status: doing
- agent: Claude Code on manjeet
- started: 21:19 IST
- priority: P0
- depends: none
- touches: package.json, package-lock.json, next.config.ts, tsconfig*.json, src/app/, src/main.tsx (deleted), index.html (deleted), vite.config.ts (deleted), src/index.css (moved to src/app/globals.css), .gitignore
- do: Switch to the Next.js App Router with `output: "export"`, so the app stays static with no server and the CROPS promise holds. The page is client-only. The UI stays unchanged.
- done when: `npm run build` produces `out/`, `npm run dev` serves http://localhost:5173 with the same UI, and `npm run check` passes.
- log:

### T10 · Classify failed frames correctly
- owner: manjeet
- status: doing
- agent: Claude Code on manjeet
- started: 21:17 IST
- priority: P0
- depends: none
- touches: src/diagnose.ts, src/diagnose.check.ts, src/samples/
- do: Classify each failed frame as **out of gas** (≥98% of its limit), **logic revert** (below 98%; the text must say "raising gas won't help"), or **skipped** (status 0x2), plus "payer charged anyway". Add tx `0x6137f039a0b152e5b1d20be99abd3f3a1a24891cd4f30fcc22ad9b59f7a93c75` as a sample. It's a logic revert: frame 2 used 8,158 of 50,000.
- done when: `node src/diagnose.check.ts` passes with ≥5 cases, including the 0x6137 logic revert.
- log:

### T11 · Correct advice and parse thresholds
- owner: manjeet
- status: todo
- agent:
- started:
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
- log:

### T12 · Frame tx builder and signer (`src/engine/frames.ts`)
- owner: manjeet
- status: todo
- agent:
- started:
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
- log:

### T13 · Dry run (simulate) adapter
- owner: manjeet
- status: todo
- agent:
- started:
- priority: P0
- depends: T12
- touches: src/rpc.ts, src/diagnose.ts
- do: Implement `simulate(rawTx)` using `ethrex_simulateFrameTransaction [raw, "latest", {trace:true}]` on the ethrex RPC. Map the result into the same findings as a receipt, so `diagnose` works on a draft before it's sent.
- done when: a draft with frame 3's gas set too low shows "Frame 3 would run out of gas, raise to N" without sending anything.
- log:

### T14 · Send and watch status
- owner: manjeet
- status: todo
- agent:
- started:
- priority: P0
- depends: T13
- touches: src/rpc.ts
- do: `sendFrameTx(raw)` uses `eth_sendFrameTransaction` on the **gateway**. `watchTx(hash, cb)` polls `skandha_explorer_getTransaction` every 2 s, then the receipt, and goes pending → admitted/rejected → included/failed. Stop after 120 s.
- done when: one real send of a T12 draft (**ask your human first**) reports admitted, then included. The hash goes in the log.
- log:

### T15 · Uniswap re-quote fix (P1)
- owner: manjeet
- status: todo
- agent:
- started:
- priority: P1
- depends: T14
- touches: src/engine/, src/diagnose.ts
- do: When the paymaster VERIFY fails as underpaid, re-read the price (paymaster `quote()`, or V4Quoter `0xeEa49CC6419125E2f706bf7f95Cf34ac7e93087D`) and set the fix to "pay X tUSD". Fix & send then uses the new amount.
- done when: T09's sample shows the re-quoted amount, and a resend with it is admitted.
- log:

### T16 · "Why did it revert" spike (P1, 20 minute cap)
- owner: manjeet
- status: todo
- agent:
- started:
- priority: P1
- depends: T13
- touches: src/rpc.ts, src/diagnose.ts
- do: Try `ethrex_simulateFrameTransaction` with the parent block number instead of "latest" for an included tx, to get `revertData`, then decode it. If it doesn't work within 20 minutes, set `done` with "not supported" in the log.
- done when: 0x6137 shows a revert reason, or the log says it isn't supported.
- log:

### T17 · Fragility flag (P1)
- owner: manjeet
- status: todo
- agent:
- started:
- priority: P1
- depends: T13
- touches: src/diagnose.ts
- do: If the simulation trace shows a VERIFY frame reading storage of a shared contract (the v4 PoolManager), add a warning finding: "This tx depends on the pool price; a swap can invalidate it before inclusion."
- done when: our Mode A draft shows the warning.
- log:

### T30 · Pitch, video script and submission text
- owner: manjeet
- status: todo
- agent:
- started:
- priority: P0
- depends: none (finalise after 01:00)
- touches: docs/PITCH.md, docs/SUBMISSION.md
- do: A 90-second demo script following PRD §7:
  1. 0xe97e: admitted but failed.
  2. 0x6137: the explorer can't say why.
  3. Our own send fails, then Fix & send, then admitted, paid in tUSD with 0 ETH.

  Also write the ETHGlobal submission text (description, how it's made, tracks), plus answers for "why the alt mempool" and "why Uniswap".
- done when: both docs are on `main` and the script reads out in under 3 minutes.
- log:

---

## esh: UI (Windows)

### T20 · Rename to Readmit and use the familiar tx-page layout
- owner: esh
- status: todo
- note: wait for T00 (Next.js migration) to be done, then pull before starting
- agent:
- started:
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
- log:

### T21 · Wallet panel
- owner: esh
- status: todo
- agent:
- started:
- priority: P0
- depends: none (stub until T07; `// stub:`)
- touches: src/ui/Wallet.tsx, src/App.tsx (mount only)
- do:
  - Add an "Import demo key" field. The key is stored in localStorage on this device only.
  - Show the wallet address (from `contracts/deployments/1337.json` `demoWallet`), the tUSD balance (`balanceOf` via `eth_call`) and the ETH balance, which should be 0.
  - Add a short "test key, devnet only" note.
- done when: after T07, the real wallet shows 100 tUSD and 0 ETH.
- log:

### T22 · Send screen (Flow B)
- owner: esh
- status: todo
- agent:
- started:
- priority: P0
- depends: T21 (UI against stubs first), then T12, T13 and T14 for the real thing
- touches: src/ui/Send.tsx, src/App.tsx (mount only)
- do:
  - Recipient and amount fields with one **Send** button.
  - Steps shown as a timeline: Checking (dry run) → Signing → Sent → Admitted → Included, with an explorer link.
  - Show the fee: "Gas paid: X tUSD, ETH used: 0".
  - Errors in plain words, with next steps: dry-run failure, which shows the diagnosis; rejected; timeout.
- done when: a real send from the demo wallet reaches Included in the UI. Put the hash in the log.
- log:

### T23 · Fix & send
- owner: esh
- status: todo
- agent:
- started:
- priority: P0
- depends: T22
- touches: src/ui/Send.tsx, src/ui/FixAndSend.tsx
- do:
  - Add a "Send with low gas (demo)" toggle that sets the last frame's gas too low.
  - When the dry run or receipt reports out of gas, show the fix and a **Fix & send** button. It applies the new limit, re-runs the dry run and sends.
  - Show the old hash ❌ next to the new hash ✅.
- done when: one live round trip is recorded in the log, with the failed or caught draft and the admitted hash.
- log:

### T24 · CROPS section in README
- owner: esh
- status: todo
- agent:
- started:
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
- log:

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
- status: todo
- agent:
- started:
- priority: P1
- depends: T23
- touches: src/index.css, docs/img/
- do: Check that 375 px works, focus is visible, contrast is OK and there are no trackers in the network tab. Save 3 screenshots for the README.
- done when: the screenshots are in `docs/img/`.
- log:

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
