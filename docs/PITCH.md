# Readmit: demo script and judge Q&A

This is a 3-minute video; the live demo part is about 90 seconds. Everything runs on the EF alt-mempool devnet (chain 1337).

**Prize order:**
1. EF Alt Mempool. We are in its **developer tooling** area: an admission simulator.
2. EF CROPS. It shares the EF slot, so EF places us in one of the two.
3. Uniswap, as the supporting story.

Answers to hard questions are in [DEFENSE.md](DEFENSE.md).

## The one line
"When a frame transaction fails, Readmit shows which frame failed, why, and the number to change. For your own transactions it dry-runs the fix and gets it admitted. That includes failures that happen after the mempool already said yes."

Two things to say accurately:
- **Diagnosis works on anyone's transaction.** Fix & send works on your own, because we can only re-sign with your key.
- **The fix number is computed.** For out of gas it's the gas used × 1.25, rounded up, and the fix is checked by a fresh dry run before anything is sent.

## Script (spoken lines are in quotes)

**0:00–0:15 · The gap**
- "A rejected frame transaction never reaches a block, so there's no Etherscan page for it. The alt-mempool explorer gives you a rule name. And a transaction can be admitted and *still* fail, with the payer charged anyway. Developers end up guessing."

**0:15–0:35 · Diagnose anyone's transaction**
- Click the sample **"Logic revert"** (`0x6137f039…a93c75`, a real tx on the current devnet, block 2,993).
- "The explorer says 'frame 2 did not succeed'. Readmit shows frame 2 stopped at 8,158 of 50,000 gas, 16%. That's not a gas problem, so raising gas won't help. The payer was still charged 0.000482 ETH."
- Click **"Ran out of gas"** (`0xe97e…`, a saved copy from an earlier devnet run).
- "Here it's the opposite: 29,925 of 30,000. It ran out of gas, and the number to change is about 38,000."

**0:35–1:15 · Our own transaction: caught before it costs anything, then fixed**
- The wallet panel shows **about 80 tUSD and 0 ETH**. Enter recipient and amount, tick **"Send with low gas (demo)"**, and press **Send**.
- "Before anything is broadcast, Readmit dry-runs it on the node. Frame 3 would run out of gas: 16,000 of 16,000. Caught, never sent."
- Press **Fix & send**. "It applies the new limit, re-quotes the tUSD fee from the Uniswap pool, dry-runs again, and sends."
- Show the timeline Admitted → Included, and "Gas paid: about 2.7 tUSD, ETH used: 0". Proven live: `0xf09e55cf…0d4e` (block 7,261).

**1:15–1:35 · Why this needs the alt mempool**
- "Our paymaster prices gas from a Uniswap v4 pool while it validates. The public mempool forbids that read. Readmit's dry run shows 'StorageReadNonSender'. The alt mempool admits it because the paymaster is staked. Readmit shows both verdicts side by side."

**1:35–1:50 · Honest limits**
- "It reads a spot price, `slot0`, which can be moved. We quote with about 7% headroom, and if the price moves, Readmit catches 'underpaid' and re-quotes. A TWAP or guarded price is next."

## Judge Q&A (short answers)
**"Isn't this just the explorer with a nicer skin?"**
The explorer reports admission. Readmit adds:
- gas used per frame from the receipt;
- out of gas vs logic revert;
- what the payer was charged;
- a dry run before you send;
- the number to change, then Fix & send;
- for a fresh failure, a replay on the previous block that gives the real revert reason. The node keeps 128 blocks, about 13 minutes.

**"Another team here (FrameGas) also has a Uniswap-priced paymaster."**
Yes, and theirs goes further on the paymaster: it swaps and settles on v4 and has a price guard. Our paymaster is the payment rail for the demo. **Our product is the debugger: diagnose anyone's failed tx, catch failures before broadcast, and Fix & send.** We didn't find that anywhere else.

**"Why does this need the alt mempool?"**
- Validation that reads foreign storage, like a v4 pool, is refused by the canonical mempool.
- Validation gas is capped at 100k.
- Readmit names the sidecar's own rules (OP-011, storage, simulation…) with its own numbers.

**"What is your smart contract?"**
`V4PricedPaymaster`, deployed and staked on chain 1337 at `0xc9ca898B92fA53635959021239E190Cf22c1F1d9`. In its VERIFY frame it:
1. reads the pool's `slot0`;
2. prices the tx's maximum cost in tUSD plus 10%;
3. requires the next frame to be `tUSD.transfer(paymaster, ≥ quote)` and the sender to hold that tUSD;
4. then approves payment.

Golden tx: `0x3fd93ca4…4b9c`.

**"Is the gas-cap advice right?"**
Yes. This sidecar caps validation at 100,000 gas whether or not you stake, so Readmit never says "stake" for that. For an unstaked storage read, staking *is* the fix, and Readmit says so.

**"Does it work on mainnet?"**
Not yet. Frame transactions arrive with the Hegotá upgrade, expected in 2027. Readmit reads the node's own rules and numbers, so it adapts when they change.

**"What breaks first?"**
- The fix catalogue is matched against one sidecar's error messages. We already handle two wordings of the gas-cap error.
- Revert replay depends on the node keeping recent state.

**"Privacy and CROPS?"**
- It's a static site with no backend of ours, and the endpoints are editable, so you can use your own node.
- Fonts are self-hosted, and there are no trackers.
- The demo key stays in the browser and is test-only.
- Trade-offs are in the README.
