# Readmit: demo script and judge Q&A

**Video length: 2:15 to 2:50.** ETHGlobal rejects videos under 2:00 or over 4:00 at upload, and the EF CROPS prize allows at most 3:00. Record a human voice (no text-to-speech) with a laptop screen recorder at 1080p, not a phone. Cut waiting time with edits; never speed the footage up. Slides: at most 4 bullets each. Everything runs on the EF alt-mempool devnet (chain 1337).

**Before recording:** open **Demo account ▾** (top right) and import the demo key, then reload once so the live list has loaded. The finalist live demo is 4 minutes plus 3 minutes of Q&A: use the same script and skip the slides.

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
- The **Demo account** button (top right) shows our tUSD balance, and its panel shows **0 ETH**. Don't say a balance number; it changes with every send. Enter recipient and amount, tick **"Send with low gas (demo)"**, and press **Send**.
- "Before anything is broadcast, Readmit dry-runs it on the node. Frame 3 would run out of gas: 16,000 of 16,000. Caught, never sent."
- Press **Fix & send**. "It applies the new limit, re-quotes the tUSD fee from the Uniswap pool, dry-runs again, and sends."
- Show the timeline Admitted → Included, and "Gas paid: about 2.7 tUSD, ETH used: 0". Proven live: `0xf09e55cf…0d4e` (block 7,261).

**1:15–1:35 · Why this needs the alt mempool**
- "Our paymaster prices gas from a Uniswap v4 pool while it validates. The canonical mempool rules forbid that read: Readmit's dry run names the rule, `StorageReadNonSender`. The alt mempool admits it because the paymaster is staked, and the timeline shows it admitted." (Read the dry-run line exactly as it appears on screen; T86 may reword it.)

**1:35–1:50 · Honest limits**
- "It reads a spot price, `slot0`, which can be moved. The paymaster charges spot plus 10%, and our quote covers the maximum cost with about 7% slack, so a small move still passes. A bigger one, the dry run catches as 'underpaid' before anything is sent, and pressing Send again re-quotes. A TWAP or guarded price is next."

**1:50–2:30 · CROPS: no server of ours**
- Open **Endpoints: use your own node** in the footer. "Static site, no backend. Your browser talks straight to ethrex and the sidecars, and you can point Readmit at your own node."
- Switch **Miner** to **Gateway** in the header and open the same hash again. "If one node refuses you, the same check runs against another." Point at the footer: "MIT, no trackers."

**2:30–2:45 · Close**
- "Readmit: which frame failed, why, the number to change, and a fix that's dry-run before it's sent. The engine is also an SDK."

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
