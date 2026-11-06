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
The engine can replay a failed transaction on the block before it to get the revert reason, but ethrex keeps state for about 128 blocks, so it works for roughly 13 minutes after inclusion. It isn't wired into the page yet.
- Evidence: `replay()` in `src/engine/frames.ts`.

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

## Limits we say plainly

- **Devnet only.** Frame transactions are expected with the Hegotá upgrade; nothing runs on mainnet.
- **Endpoints are fixed** to the EF devnet's ethrex RPC and two sidecars. Making them editable is next (T50).
- **The ERC-8421 check is partial:** the validation-gas budget and validation reverts only.
- **Revert-reason replay is engine-only** (not shown in the page yet).
- **Fix & send applies gas fixes.** The engine also makes a re-quote patch; the UI doesn't apply it yet.
- **History is in memory:** the sidecar forgets admissions on restart, so saved cases are labelled as saved.
- **Privacy trade-off:** the RPCs see your IP, and the selector lookup tells Sourcify which selectors you decoded.
