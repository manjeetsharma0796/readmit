# Readmit: product requirements (PRD)

ETHGlobal Mumbai 2026. Team of 3. Written Fri 6 Nov 20:45 IST.
- **Feature freeze:** Sat 01:00. **Code freeze:** 03:00. **Submit:** 08:00. **ETHGlobal deadline:** 09:00.
- Related docs: decision in `STATE.md`, hour plan in `PLAN.md`.

**Network:** everything runs on the EF alt-mempool devnet. That's chain 1337:
- ethrex RPC: `altmempool.forshtat.com`
- gateway: `altmempoolgateway.forshtat.com/rpc`
- explorer: `explorer.altmempool.wtf`

Test ETH only. Nothing touches mainnet.

---

## 1. One line
**Readmit tells you which frame of your frame transaction failed, why, and the exact number to change. Then it re-signs and gets the transaction admitted. That includes failures that happen after the mempool said yes.**

Framing for judges: "Tenderly's simulate-and-debug for EIP-8141 frame transactions."

## 2. Problem, with a real example from tonight
Tx `0x6137f039…a93c75` was included in block 2,993 and **reverted**.

| | Explorer today (`explorer.altmempool.wtf`) | Readmit |
|---|---|---|
| Status | "Reverted, frame(s) 2 (reverted) did not succeed" | Same, plus **why** |
| Gas per frame | Gas **limits** only | Limits **and gas used**: frame 0 used 73,756, frame 1 7,556, frame 2 **8,158 of 50,000**, frame 3 11,670 |
| Was it gas? | No answer | "Frame 2 stopped at 16% of its limit. This is a logic revert, **raising gas won't help**." |
| What was called | "388 bytes" | Selector `0x6e5141ba` (unknown in 4byte), arg `38`. Frame 3 calls `settle()` on the paymaster. |
| Cost of the failure | Not shown | "The payer `0xEe22…5Ba6` was still charged 192,880 gas ≈ 0.00048 ETH" |
| Admission report | "This node has no admission report… cleared when the node restarts" | The report is saved and downloadable the moment we fetch it |
| Next step | None | The exact fix, then **Fix & send** (for your own txs) |

**Who hurts:** any developer building on frame txs this weekend. On the gateway at 14:00 there were 13 rejections from 7 different senders. Our teammate's tx `0xe97e…fba4` was admitted, then ran out of gas in frame 4, and the payer was charged.

## 3. Users
| User | Need | Priority |
|---|---|---|
| **App developer** building on frame txs (hackathon teams, wallet devs) | "My tx failed or was rejected. What do I change?" | **Primary** |
| **End user** of an app with no ETH, paying gas in tUSD | "Send 5 tUSD without owning ETH, and don't charge me for a doomed tx" | Secondary (our demo app) |
| **Judges and the EF alt-mempool team** | "Does it really use the alt mempool and teach something true?" | Audience |

## 4. Goals and non-goals
**Goals (this hackathon):**
1. Explain any failed or rejected frame tx on the devnet in plain words, with the exact parameter fix.
2. Close the loop: fix → re-sign → **admitted on the gateway**, shown live.
3. Ship our own contract: a **paymaster that charges gas in tUSD at a live Uniswap v4 price**, staked in the alt mempool.

**Non-goals (roadmap only):**
- Mainnet.
- Other clients.
- The full ERC-8421 rule set.
- Fuzzing.
- Re-sending other people's txs: we can't sign for them, so we diagnose only.
- Production key management.
- Mobile app.

## 5. Success metrics (measured in the demo and README)
| Metric | Target |
|---|---|
| Steps from a failing hash to an admitted fixed tx | **2 clicks** (paste, Fix & send). Doing it by hand takes about 6 steps. |
| Failure classes with a working fix → re-admit loop | ≥ 3 (P0: out-of-gas) |
| Admitted txs of ours on the gateway, linked in README | ≥ 3, including 1 paid in tUSD by our paymaster |
| ETH held by the demo end user | 0 before and after |
| Wrong advice shown | 0. Every fix in the demo has been re-admitted. |

## 6. Scope and priority
**P0 = must ship by 01:00 or we don't qualify or demo. P1 = ship if P0 is green by 23:30. P2 = roadmap.**

| ID | Requirement | Priority | Owner |
|---|---|---|---|
| R1 | Diagnose any hash. Merge the gateway admission report, the ethrex receipt, and per-frame gas used vs limit. | P0 | P2 |
| R2 | Classify each failed frame as **out-of-gas** (≥98% of limit), **logic revert** (below that) or **skipped**, with the plain-language "why". | P0 | P2 |
| R3 | Fix text for the P0 classes: OOG (new limit = used × 1.25, rounded), bad signature, replacement fee, verify-gas over cap. The verify-gas fix is "lower the limits"; never say "stake" on the stock sidecar. | P0 | P2 |
| R4 | Decode calls (4byte) and show the cost of the failure ("payer was still charged X ETH") | P0 | P2 (already built) |
| R5 | **Our contract live:** tUSD, the ETH/tUSD v4 pool and `V4PricedPaymaster` deployed and staked on chain 1337. Addresses in `deployments/1337.json`. | P0 | P1 |
| R6 | **Demo wallet:** a smart wallet owned by a browser key, pre-funded with tUSD and 0 ETH, made by P1's script before the demo | P0 | P1 |
| R7 | **Send:** build frames → dry run (`ethrex_simulateFrameTransaction`) → sign → `eth_sendFrameTransaction` to the gateway → poll status → show admitted/included and the explorer link | P0 | P3 (+P2 encoder) |
| R8 | **Fix & send** for our own txs: apply the fix (OOG gas limit) to the stored draft, re-sign, re-send, and show the new admitted hash next to the old failed one | P0 | P3 |
| R9 | Rename to **Readmit**. Use a familiar layout (see §8). | P0 | P3 |
| R10 | Uniswap re-quote: when the paymaster's price check fails, re-read v4 `slot0` / V4Quoter and suggest the new tUSD amount | P1 | P2 |
| R11 | "Why did it revert": re-simulate at the parent block to get the revert data and decode it. **Unverified** whether ethrex simulates at historical blocks; spike for 20 minutes only. | P1 | P2 |
| R12 | Draft builder: up to 6 frames, with the user's own actions | P1 | P3 |
| R13 | Fragility flag: "this tx depends on shared state (pool `slot0`), so a swap can invalidate it" | P1 | P2 |
| R14 | CROPS: Nox Anon-RPC toggle for reads and sends, plus the README CROPS section | P1 (README part is P0) | P3 |
| R15 | MetaMask as signer (`personal_sign`). The wallet's VERIFY accepts EIP-191. | P2 | P3/P1 |
| R16 | Self-serve onboarding (factory clones plus an onboarding endpoint) | P2 | P1 |
| R17 | Mode B swap-to-pay paymaster: **only if Mode A isn't admitted by 22:00** | Fallback | P1 |

## 7. User flows
### Flow A: developer diagnoses a hash (P0)
1. Paste the hash, or click one in the "Live from the gateway" list.
2. The page shows three verdicts:
   - **Mempool:** admitted, rejected, or no report.
   - **Chain:** executed, failed, or not included.
   - **Spec:** a partial ERC-8421 check.
3. "What happened" gives one card per problem: frame, why, and the **Fix** line.
4. The frames table shows each frame's role, target, decoded call, gas used / limit as a bar, and status. The failed frame is red.
5. **Download report** (JSON). It survives node restarts, unlike the explorer.

### Flow B: end user sends with tUSD (P0)
1. Open Readmit. The demo wallet loads with **100 tUSD and 0 ETH**.
2. Choose "Send tUSD" and enter an amount and recipient.
3. Readmit builds the frames:

   | # | Mode | Target | Does |
   |---|---|---|---|
   | 0 | VERIFY | wallet | signature check → approve execution |
   | 1 | VERIFY | `V4PricedPaymaster` | reads v4 `slot0`, checks frame 2 pays ≥ `quote()` and the sender has the tUSD → approve payment |
   | 2 | SENDER | tUSD | `transfer(paymaster, quote)` |
   | 3 | SENDER | tUSD | `transfer(recipient, amount)` |

4. **Dry run.** If it fails, go to Flow C.
5. Sign and send. The status goes pending → admitted → included, with an explorer link. "You paid 3.3 tUSD for gas, ETH used: 0."

### Flow C: fix & send (P0 for OOG, P1 for others)
1. The dry run or receipt shows, for example, "Frame 3 ran out of gas: 29,925 / 30,000. Fix: raise it to 38,000."
2. Click **Fix & send**. Readmit edits the draft, re-runs the dry run (green), re-signs and sends.
3. Show the old hash ❌ beside the new hash ✅, with both explorer links.

**Demo script for the judges (90 s):**
1. "This tx was admitted, still failed, and the payer paid" (Flow A on `0xe97e…`).
2. "Here's one that reverted, and the explorer can't tell you why" (`0x6137…`, logic revert, not gas).
3. Our own send fails on purpose with a low gas limit. Click Fix & send, and it's admitted. "All in tUSD, priced live by Uniswap v4, 0 ETH."

## 8. UX requirements (founder: "familiar, no learning curve")
- **The model is Etherscan's tx page plus Tenderly's simulator.** Each element follows a pattern users already know:
  - a tx header with hash, status badge, block, payer and fee;
  - a table of rows;
  - a red highlight on the failed row;
  - an expandable trace.
- One primary action per screen: **Inspect**, **Send**, or **Fix & send**.
- Use plain words, not protocol jargon:
  - "Approves execution" instead of "VERIFY flags 0x2";
  - "Ran out of gas" instead of "status 0x0 at ≥98%".
- Protocol detail lives behind "Show technical details".
- Numbers use thousands separators. Addresses are shortened with a copy button. Each hash has an explorer link.
- Errors say what to do, for example "This hash isn't on chain 1337. Check the network."
- Works at 375 px width. Keyboard focus is visible. No trackers or analytics.

## 9. Architecture
```
Browser (Next.js 16 static export + React + TS, no backend)
 ├─ engine/diagnose.ts     pure: report + receipt (+ simulation) → findings, verdicts
 ├─ engine/frames.ts       build + sign frame tx  (@forshtat/hegota-support)
 ├─ rpc.ts                 ethrex RPC · gateway sidecar · 4byte · (Nox Anon-RPC toggle)
 └─ UI                     Inspect · Send · Fix & send
        │                         │
        ▼                         ▼
ethrex  altmempool.forshtat.com   Gateway sidecar  altmempoolgateway.forshtat.com/rpc
  eth_getTransactionReceipt         eth_sendFrameTransaction
  ethrex_simulateFrameTransaction   skandha_explorer_getTransaction / listAdmissions
        │
        ▼
Chain 1337 contracts (ours)                    Chain 1337 contracts (predeployed)
  tUSD (TestERC20)                               Uniswap v4 PoolManager 0x6bF9…9848
  V4PricedPaymaster (staked 0.012 ETH)           V4Quoter 0xeEa4…087D, StateView 0xd89a…43FB
  demo wallet (workshop ExampleWallet)           Staking registry 0xD51c…2F
```

## 10. Contract spec (P1)
**`V4PricedPaymaster`** (`tracks/uniswap-kit/src/`; written and fork-tested, not deployed):
- `constructor(IPoolManager pm, PoolId id, address token) payable`: the ETH deposit pays users' gas.
- `quote(uint256 weiCost) view → tUSD`: the price from `StateLibrary.getSlot0`, with a +10% markup.
- `fallback()`, the VERIFY frame:
  - next frame must be SENDER → `TOKEN.transfer(this, paid ≥ quote(MAX_COST))`;
  - `balanceOf(sender) ≥ paid`;
  - then `APPROVE(PAYMENT)`.
- `stake(uint32 delay, IStakingRegistry r) payable`: forwards `addStake`, so the paymaster itself is the staked entity. Use 0.012 ETH and 86,400 s.
- **Add tonight:** `owner` plus `withdraw(to, eth, tusd)`. This takes about 20 minutes.

**Deploy:**
- `forge install uniswap/v4-core@main` (the `lib/` folder is missing locally).
- `forge script SetupPool --skip-simulation -g 105 --broadcast`, with liquidity shrunk to ≤0.5 ETH.
- Then run `StakePaymaster`.
- Take gas limits from `cast estimate`. Every tx must stay under 16.7M gas.

**Mode B (fallback, R17):** the paymaster's VERIFY checks only frame params:
- frame k+1 calls `PoolSwapTest.swap` (tUSD→ETH);
- frame k+2 sends ≥ `MAX_COST` wei to the paymaster.

There's no foreign storage read, so no stake is needed.

## 11. Diagnosis catalogue
| Class | Source | Detect | Fix text | Priority |
|---|---|---|---|---|
| Out of gas | receipt | frame `0x0`, used ≥ 98% of limit | "Raise frame N to ⌈used×1.25⌉" | P0 |
| Logic revert | receipt | frame `0x0`, used < 98% | "Not gas. The call to `fn` reverted; check its inputs and state." Re-simulate for the reason (R11). | P0 |
| Skipped (atomic batch) | receipt | frame `0x2` | "Skipped because frame M in the same batch failed" | P0 |
| Charged anyway | receipt | tx status `0x0` | "The payer paid X ETH for a failed tx. Dry-run before sending." | P0 |
| Validation gas over cap | gateway detail | `exceeds MAX_VERIFY_GAS 100000` | "Lower VERIFY limits; this sidecar caps 100k staked or not. ERC-8421 would allow 1M if staked (sidecar PR #2 open)." | P0 |
| Validation revert / bad signature | gateway detail | `validation frame N: reverted with data 0x…` | Decode the error. "Signed over the wrong hash or with the wrong key." | P0 |
| Replacement fee too low | gateway detail | `cannot be replaced: fee too low` | "Bump both fees by ≥10% or use the next nonce" | P0 |
| Payer can't cover cost | gateway detail | `has 0 wei, … maximum cost` | "Fund the payer or lower limits/fees" | P1 |
| Unstaked foreign storage read | gateway detail | `unstaked … accessed … slot` | "Stake the entity (0.012 ETH) or don't read that storage" | P1 |
| Banned opcode | gateway detail | `banned opcode: X` | "Remove X from validation" | P1 |
| Price moved (our paymaster) | simulation / VERIFY revert | underpaid | "Pay Y tUSD (re-quoted from v4)" | P1 |
| Anything else | gateway detail | fallback | Show the sidecar's rule name and detail verbatim, without guessing | P0 |

**Rule:** use the sidecar's own rule names. Cite ERC-8421 IDs only as "the spec says".

## 12. Team plan (from 20:45)
| Time (IST) | P1: contracts / infra | P2: engine | P3: UI / send / story |
|---|---|---|---|
| 20:45–21:00 | **Status sync.** Do we already have an admitted tx of ours? Are the contracts deployed? Everyone reads this PRD. | | |
| 21:00–22:00 | Reinstall v4-core, add `owner`/`withdraw`, deploy tUSD, pool and paymaster, stake (R5) | R2 + R3 classes and the R11 spike (20 min cap). Add the `0x6137…` and `0xe97e…` fixtures to the self-check. | Rename to Readmit. Familiar tx-page layout (R9). |
| **22:00** | **Gate: a Mode A tx is admitted on the gateway.** If not, start Mode B (R17) with a deadline of 00:30. | | |
| 22:00–23:30 | Demo wallet (R6) and tUSD funding. Save every hash to the README. | Frame builder and encoder for Flow B (with P3). Self-check covers all P0 classes. | Send flow (R7): dry run → sign → send → status |
| **23:30** | **Gate: Flow B plus Flow C (OOG) work end to end.** If not, cut to Flow A plus one admitted send, and everyone fixes that. | | |
| 23:30–01:00 | Uniswap README section with line links, and `FEEDBACK.md` | R10 re-quote and R13 fragility (P1) | Fix & send polish (R8). CROPS README; Nox toggle only if time allows (R14). |
| **01:00** | **Feature freeze** | | |
| 01:00–03:00 | Full demo run on the live devnet. Record a backup screen capture. | Bug fixes | README: architecture, addresses, hashes, mocks disclosed |
| **03:00** | **Code freeze**, tag `v1.0`, repo public (MIT). Record the ≤3 min video together. | | |
| 07:00 | Check the devnet still has our txs. If it was reset, re-run the deploy script and update the hashes. | | Fill in the submission form |
| **08:00** | **Submitted.** Select Uniswap, EF Alt Mempool and EF CROPS. Send the Uniswap feedback form. | | |

**Done-checks:**
- R5: addresses have code (`eth_getCode`).
- R7: the gateway shows our hash as `admitted`.
- R8: the README lists the old failed and new admitted pair.
- R3: `node src/diagnose.check.ts` passes with the new fixtures.

## 13. Tracks and qualification
| Prize | Qualifies when | Owner |
|---|---|---|
| **EF Alt Mempool** ($5k) | An admitted tx link on the devnet explorer **and** code that submits one (R7). The team can explain the design and trade-offs. | P1/P3 |
| **EF CROPS** ($3.5k; same partner slot, EF places us in at most one) | MIT repo, a README "CROPS" section (one or two lines per letter), the video shows the lead property (C: refused by one mempool, admitted by another), no trackers | P3 |
| **Uniswap** ($10k) | Public repo, `FEEDBACK.md`, the Uniswap feedback form (a human, at 07:30), and README links to `quote()` / `getSlot0`, `SetupPool`, and the V4Quoter call | P1 |

## 14. Risks
| Risk | Signal | Mitigation |
|---|---|---|
| The gateway doesn't honour stake, so the pool read is banned | Mode A tx rejected with an "unstaked … accessed" detail at 22:00 | Mode B (R17). Ask Pierre/Alex now. |
| Devnet reset | Our hashes disappear | Idempotent deploy script, offline fixtures, re-check at 07:00 |
| Our price-move demo damages paymaster reputation | Gateway "throttled/banned" | Run `MovePrice` at most 3 times, and record that part early |
| Wrong advice in front of the sidecar authors | n/a | Show only fixes we have re-admitted. Parse thresholds from detail strings, never hardcode them. |
| Too little time for all P0 | 23:30 gate fails | Cut to Flow A plus one admitted tUSD-paid send |

## 15. Open questions (ask now)
1. **Pierre/Alex:** does the public gateway honour stake, i.e. is a staked paymaster reading v4 PoolManager storage admitted?
2. **Pierre/Alex:** can you drip about 1.5 ETH to our deployer?
3. **Team:** is P1's golden admitted tx done? Which addresses are deployed already?
4. **ethrex:** does `ethrex_simulateFrameTransaction` accept a historical block tag? This decides R11.
