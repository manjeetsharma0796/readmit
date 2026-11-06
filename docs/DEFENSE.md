# Readmit: judge defense sheet

The hardest questions we expect, each with a short true answer and the evidence behind it. Answer in two sentences, then stop. If something is not built or not measured, say so.

Checked live on the EF devnet (chain 1337) on Fri 6 Nov, 23:58 IST. Numbers marked *snapshot* come from the node's in-memory history and change after a restart.

## Is it real?

**"Isn't this just a nicer explorer?"**
A rejected frame transaction never reaches a block, so an explorer has nothing to show; Readmit reads the mempool sidecar's own admission report and names the rule that failed. For transactions that did land, it adds per-frame gas, out of gas vs logic revert, the payer's cost and the fix, and for your own transaction it re-signs and resends.
- Evidence: 9 of the 12 saved cases in the app are rejections that never reached a block ("Rejected by the mempool").

**"Who needs this?"**
Every team building frame transactions this weekend: the miner node rejected 52 of its last 200 transactions, from 14 different senders, in about 2 hours (*snapshot*). The top rule was `simulation` (42 times), then `OP-011` (7).
- Evidence: the live stats line under "Live from the miner node" in the app.

**"Did you actually send anything?"**
Yes. A wallet holding 0 ETH sent 1 tUSD and paid 2.969998 tUSD of gas to our paymaster; it was admitted with 24 of 24 checks and included in block 6,065 with all 4 frames successful.
- Evidence: [`0x3fd93ca4…4b9c`](https://explorer.altmempool.wtf/tx/0x3fd93ca4a082d636d08fc27a8afd65b6449dda7aff6609736e8f080064724b9c?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc). The paymaster's VERIFY frame used 52,848 gas.
- Paymaster `0xc9ca898B92fA53635959021239E190Cf22c1F1d9` (code deployed), staked in tx `0x84c42869…22a9` (block 6,010).

**"The 0xe97e… example doesn't open in the explorer."**
That transaction is from an earlier run of the devnet (block 405,125); the devnet has since been reset and is now around block 7,200. Readmit shows it from a saved copy and labels it "Saved sample, not fetched live".
- Evidence: `src/samples/reverted-out-of-gas.json`. The logic-revert example `0x6137…` is still on the current chain (block 2,993, frame 2 failed at 8,158 gas).

**"One of your Fix & send transactions was dropped. Is your fix broken?"**
No. `0x6fa1abb2…` was admitted with every check passing, then the miner reported "relayed 4 times without being included". Its exact bytes still dry-run successfully at the latest state (all 4 frames, frame 3 uses 18,461 of 20,000), and its 2 gwei max fee is far above the ~7 wei base fee, so it was valid and priced right; the same flow was included in block 7,261 (`0xf09e55cf…`).

## Is the advice right?

**"Is 38,000 the exact gas you need?"**
No, it's an estimate with a margin: the gas the frame used, plus 25%, rounded up to the next 1,000 (29,925 → 38,000). The app says this on screen, and Fix & send checks the new limit with a fresh dry run before sending.
- Evidence: `roundUp(used * 1.25)` in `src/diagnose.ts`; the "How we got 38,000" line on the result page.

**"How do you tell out of gas from a logic revert?"**
A failed frame that used at least 98% of its limit is called out of gas; below that, it's a revert and we say raising gas won't help. It's a threshold, so a revert that happens right at the limit could be mislabelled as out of gas.
- Evidence: `OOG_SHARE = 0.98` in `src/diagnose.ts`; `0x6137…` stopped at 8,158 of 50,000 (16.3%).

**"Why don't you tell people to stake when they hit the gas cap?"**
Because it wouldn't help: this sidecar caps validation at 100,000 gas for every account, staked or not. We only suggest staking where it is the fix, an unstaked storage read.
- Evidence: the sidecar's own text in `src/samples/verify-gas-over-cap.json`: "… exceeds MAX_VERIFY_GAS 100000".

**"Where do your rule names and numbers come from?"**
From the sidecar's detail text, parsed at read time, never hardcoded; an unknown rule is shown word for word.
- Evidence: the "Technical details" section lists every rule the sidecar ran, with its own detail text.

**"Why did it revert?" for an old transaction**
For a fresh on-chain failure, Readmit replays it on the block before it: that proves the failure is reproducible and shows the revert message when the node returns one. ethrex keeps state for about 128 blocks, so it works for roughly 13 minutes, and for execution-phase reverts the node currently returns no message.
- Evidence: `replay()` in `src/engine/frames.ts`; live, `0x5f29af86…` replayed to "fails at frame 3 again" and `0xf52f56f8…` showed "too old to replay".

## Uniswap

**"`slot0` is a spot price. Can't someone manipulate it?"**
Yes, within a block, so this design is for a test network and we say so: the paymaster charges spot plus 10%, and the send dry run warns that a swap can invalidate the transaction before inclusion. A TWAP or oracle hook is the next step before real money.
- Evidence: comment in `contracts/src/V4PricedPaymaster.sol` line 23; `FEEDBACK.md` item 2; the dry run's pool-price warning.

**"Someone else at this event built a Uniswap-priced paymaster."**
Yes (FrameGas). Our paymaster is the payment rail; the product is the debugger and Fix & send, which we did not find anywhere else.

**"Why does this need the alt mempool?"**
Our paymaster reads the Uniswap pool's storage while validating. The canonical rules forbid that read (`StorageReadNonSender`); the ERC-8421 alt mempool allows it because the paymaster is staked.
- Evidence: the dry run of `0x3fd93ca4…` reports the public mempool would refuse it with `StorageReadNonSender` (README, "A transaction paid in tUSD").
- Say it as "the canonical rules would refuse it", not "another mempool refused it": we show the canonical check, not a second live mempool.

## From the research (full sources in [RESEARCH.md](RESEARCH.md))

**"ERC-8421 gives staked entities 1M validation gas. Why do you say 100k?"**
Because that's what the running sidecar enforces: it sums every validation frame plus the signature cost and rejects anything over `MAX_VERIFY_GAS = 100_000`, before it looks at stake. The spec's 1M is per staked entity, and the sidecar change for it (PR #3, opened 6 Nov) is still open.
- Evidence: [`validationPrefix.ts` line 10](https://github.com/forshtat/mempool-workshop-sidecar/blob/master/packages/executor/src/services/UserOpValidation/utils/validationPrefix.ts); [sidecar PR #3](https://github.com/forshtat/mempool-workshop-sidecar/pull/3) (open, not merged).

**"What does `COD-010` mean?"**
On this sidecar it means the validation touched an address with no code, which ERC-8421 calls CALLING-010; it is not ERC-7562's "code hash changed" rule of the same name. Readmit shows the sidecar's own detail text word for word, so it doesn't inherit the mislabel.
- Evidence: [`sidecar_explorer.md`](https://github.com/forshtat/mempool-workshop-sidecar/blob/master/docs/sidecar_explorer.md); [ERC-7562](https://eips.ethereum.org/EIPS/eip-7562).

**"Is 98% a standard out-of-gas test?"**
No, it's our heuristic. It fits the 1/64 rule (a parent keeps 1/64 of its gas, so a nested out-of-gas lands at about 98.4% used), but it can mislabel failures that burn all gas without being fixable with more (INVALID, old-style `assert`), so the dry run before sending is the real check.

**"Why 1.25× and not something else?"**
There is no standard: MetaMask multiplies its estimate by 1.5, SDKs commonly use about 1.2, and ours is applied to the gas actually used. For validation frames the result must also fit the combined 100k cap.

**"Is the payer always charged when a frame fails?"**
Only once a payer exists. If a VERIFY frame fails, the transaction is invalid, never lands and nobody pays; that's why Readmit says "payer charged" only for transactions that landed with a failed frame.
- Evidence: [EIP-8141](https://eips.ethereum.org/EIPS/eip-8141); [ethrex frame docs](https://github.com/forshtat/ethrex/blob/9aa3645d795945c64400f41a70aace0edfa7f383/docs/eip-8141.md).

**"Does staking make your paymaster safe?"**
Staking makes the pool read admissible in the alt mempool; it doesn't make the price safe. The spot price can still move within a block and every swap forces revalidation, so we rely on the 10% markup and the transaction's max fee, and a cached or oracle price is the next step.

**"Is there any other tool for frame transactions?"**
We found a draft frame-transaction PR in viem and a design post from Ethernal, and nothing that names the failed frame or proposes and sends a fix. That is absence of evidence, so we say "we found none", not "none exists".
- Evidence: [viem #4486](https://github.com/wevm/viem/pull/4486).

## Limits we say plainly

- **Devnet only.** Frame transactions are expected with the Hegotá upgrade; nothing runs on mainnet.
- **Endpoints default to the EF devnet** (ethrex RPC and two sidecars); you can point Readmit at your own nodes in the footer.
- **The ERC-8421 check is partial:** the validation-gas budget and validation reverts only.
- **Revert reasons need fresh state:** the replay works for about 13 minutes after inclusion, and the node returns no message for execution-phase reverts.
- **Atomic batches:** frames that ran before a failure in the same atomic batch keep status 0x1 but are rolled back; the frames table shows them as "Succeeded".
- **Fix & send applies gas fixes.** The engine also makes a re-quote patch; the UI doesn't apply it yet.
- **History is in memory:** the sidecar forgets admissions on restart, so saved cases are labelled as saved.
- **Privacy trade-off:** the RPCs see your IP, and the selector lookup tells Sourcify which selectors you decoded.
