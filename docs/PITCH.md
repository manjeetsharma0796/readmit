# Readmit: demo script and judge Q&A

Target length is 90 seconds of demo inside a 3-minute video. Everything runs live on the EF alt-mempool devnet (chain 1337).

**Fill before recording:** every `[TODO …]` below. Never read out a hash or number we don't have.

## The one line
"Readmit tells you which frame of your frame transaction failed, why, and the exact number to change. Then it re-signs it and gets it admitted. That includes failures that happen after the mempool already said yes."

## 90-second demo
**0:00–0:15 · The problem, using someone else's real tx**
- Open Readmit and paste `0xe97e271c…fba4`.
- Say: "The alt mempool **admitted** this transaction. It still failed, and the payer **paid** for it. The explorer shows a gas limit. Readmit shows frame 4 used 29,925 of 30,000, so it ran out of gas. The fix is to raise it to about 38,000."

**0:15–0:30 · What the explorer can't tell you**
- Paste `0x6137f039…a93c75`.
- Say: "The explorer says 'frame 2 did not succeed'. That's all it says. Readmit shows frame 2 stopped at 8,158 of 50,000 gas. That's 16%, so raising gas won't help. The call itself reverted, and the payer was still charged 0.000482 ETH."

**0:30–0:70 · Our own transaction: dry run, fix, admitted**
- Open Send. The wallet holds **100 tUSD and 0 ETH**. Send 5 tUSD with the low-gas demo toggle on.
- Say: "Before anything is broadcast, Readmit dry-runs it on the node: 'Frame 3 would run out of gas'."
- Click **Fix & send**. It's re-signed with the new limit, dry-run again, then sent to the alt-mempool gateway.
- Show Admitted, then Included. "Gas was paid in tUSD, priced live from our Uniswap v4 pool by our paymaster. ETH used: 0." `[TODO hashes: failed draft or caught case → admitted hash]`

**0:70–0:90 · Why this needs the alt mempool**
- Say: "Our paymaster reads a Uniswap pool's price while it validates. The public mempool forbids reading other contracts' storage there. The alt mempool allows it because our paymaster is staked. Readmit shows both verdicts side by side."
- `[TODO if Mode B shipped instead: "Each payment is a real Uniswap v4 swap inside the transaction, so no stake is needed."]`

## Judge Q&A (short answers)
**"Isn't this just the explorer with a nicer skin?"**
No. The explorer reports admission. Readmit adds:
- gas used per frame, from the receipt;
- out of gas vs logic revert;
- the payer's cost;
- a dry run before sending;
- the exact fix, and a re-sign and resend.

It also replays a fresh failed tx on the previous block to show the real revert reason. The node keeps state for 128 blocks, so that works for about 13 minutes.

**"Why does this need the alt mempool?"**
- The canonical mempool refuses validation that reads foreign storage, and caps validation gas at 100k.
- Our paymaster prices gas from a Uniswap v4 pool during validation. Only the alt mempool admits that, and only with stake.
- Readmit's checks use the sidecar's own rule names (OP-011, storage, simulation…) and its own numbers.

**"What exactly is your smart contract?"**
`V4PricedPaymaster`. In its VERIFY frame it:
1. reads the v4 pool's `slot0` (`StateLibrary.getSlot0`);
2. prices the tx's maximum cost in tUSD, plus 10%;
3. requires the very next frame to be `tUSD.transfer(paymaster, ≥ quote)` and the sender to hold that tUSD;
4. then approves payment.

It's staked in the alt mempool's staking registry. `[TODO address + stake tx]`

**"Does it work on mainnet?"**
Not yet. Frame transactions arrive with the Hegotá upgrade, expected in 2027. Today everything runs on the EF devnet. Readmit reads the node's own rules and numbers, so it adapts when they change.

**"What breaks first at scale?"**
- The fix catalogue is matched against one sidecar's error messages. A second ERC-8421 client means adding its message formats. We already handle two wordings of the gas-cap error.
- Revert reasons depend on the node keeping recent state, which is 128 blocks here.

**"Is the gas-cap advice right?"**
Yes. This sidecar caps validation at 100,000 gas whether or not you stake, so Readmit never says "stake" for that. For an unstaked storage read, staking *is* the fix, and Readmit says so.

**"Privacy and CROPS?"**
- It's a static site with no backend of ours, and it works against any RPC.
- Fonts are self-hosted, and there are no trackers.
- Keys stay in the browser and are test-only.
- Trade-offs are in the README.
