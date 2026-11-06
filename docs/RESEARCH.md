# Readmit answers the question frames newly create

EIP-8141 frame transactions (type `0x06`) split one transaction into up to 64 frames. Each frame has its own mode, its own gas budget and its own receipt status. The receipt has **no transaction-level status**, so "which frame failed, and was it gas?" is a question that single-status explorers cannot answer ([EIP-8141](https://eips.ethereum.org/EIPS/eip-8141)).

Readmit's core claims mostly hold up against the spec and the devnet source: the mode numbers, the receipt status codes, "the payer still pays for a failed frame", and the sidecar's flat 100,000-gas validation cap. Three places need sharper wording:

- **Flags only permit an approval scope.** The `APPROVE` opcode is what actually grants it.
- **The payer is charged only after a payer exists.** A failed VERIFY frame makes the transaction invalid, so it never lands and nobody pays.
- **The sidecar's `COD-010` label does not mean what ERC-7562's COD-010 means.**

The ERC-8421 alternative mempool is a Draft. It is still an unmerged pull request, and the devnet sidecar runs an older, pre-ERC-8421 rule set. Every explanation Readmit shows should therefore say which layer it comes from: the EIP-8141 canonical policy, the ERC-8421 draft, or the observed sidecar behaviour.

On prior art: Tenderly, Phalcon and the ERC-4337 bundler dashboards diagnose failures well. None of the sources reviewed suggests a concrete gas number and then re-signs and resends, and none supports frame transactions natively. That is Readmit's defensible gap.

Readmit's own paymaster (`V4PricedPaymaster`, the same approach FrameGas takes), which prices gas from a Uniswap v4 pool's `slot0` during validation is allowed in the alt mempool only because it is staked. It can be manipulated almost for free on a thin test pool, and it triggers revalidation (and possibly invalidation) of pending transactions whenever the pool trades. Judges will ask about this, so the answer should lead with the bounds that limit the damage.

## Frames carry their own modes, budgets and receipts

A frame transaction is a list of `[mode, flags, target, gas, value, data]` frames, plus a sender, signatures and fee fields. Two wire formats are in play, and they differ.

**Master spec.** Each frame carries a two-dimensional `limits = [execution, state]`. The fees are folded into `fees = [max_fee, max_priority_fee_per_gas]`, where `max_fee` is a total wei budget, not a per-gas price ([EIP-8141](https://eips.ethereum.org/EIPS/eip-8141)).

**Devnet version (chain 1337).** The devnet pins the 2026-07-30 text: a single `gas_limit` per frame and the classic EIP-1559/4844 fee fields ([EIP-8141 @4a9ad32c](https://github.com/ethereum/EIPs/blob/4a9ad32cf2c851d16ab889d643342074ea3fab95/EIPS/eip-8141.md)). On top of that it adds EIP-8250 keyed nonces, which replace `nonce` with `nonce_keys, nonce_seq` ([EIP-8250](https://github.com/ethereum/EIPs/blob/81b976ac01591fed2eecb73fa574f27cd18db2e8/EIPS/eip-8250.md); [mempool-workshop](https://github.com/forshtat/mempool-workshop)).

A decoder for the live devnet must parse the July format. A claim about "the spec" should cite master.

### Frame modes

There are exactly three valid modes in master ([EIP-8141](https://eips.ethereum.org/EIPS/eip-8141)):

| Mode | Name | Runs as | Notes |
|---|---|---|---|
| 0 | DEFAULT | `ENTRY_POINT` (`0xaa`) | Used for `deploy` and `post_op` frames |
| 1 | VERIFY | `ENTRY_POINT` (`0xaa`) | Runs as a STATICCALL. Only `APPROVE` may change state. If it reverts or halts, the whole transaction is invalid |
| 2 | SENDER | `tx.sender` | The spec's mempool section calls it `user_op`. Requires prior execution approval |

`ORIGIN` returns the frame's caller at every call depth. Inside DEFAULT and VERIFY frames, `msg.sender` and `tx.origin` are therefore both `0xaa`. The devnet's ethrex build also defines mode 5 (UTXO, EIP-8312) and reserves mode 4 ([ethrex docs](https://github.com/forshtat/ethrex/blob/9aa3645d795945c64400f41a70aace0edfa7f383/docs/eip-8141.md)).

### Flags and APPROVE

Bits 0–1 of `flags` hold the **allowed** approval scope: `0x1` payment, `0x2` execution, `0x3` both. Bit 2 (`0x4`) is `ATOMIC_BATCH_FLAG`.

The `APPROVE` opcode (`0xaa`) is what grants the scope. It ends the frame like RETURN and reverts in any of these cases ([EIP-8141](https://eips.ethereum.org/EIPS/eip-8141)):

- the scope is not permitted by `flags & 0x3`;
- the running code is not the frame's resolved target;
- for a payment approval: execution has not yet been approved, a payer is already set, or the payer's balance is too low.

### Who pays, and what a failed frame costs

A successful payment approval does three things at once: it bumps the sender's nonce, records `payer = resolved_target`, and **collects the full `max_cost` from the payer immediately** ([EIP-8141](https://eips.ethereum.org/EIPS/eip-8141)).

If no payer is set once all frames have run, the transaction is invalid. The validation prefix is every frame up to and including the one that sets the payer. Everything after it is the execution body.

The consequence for a debugger: once a payer exists, a failing execution frame does not refund the gas it consumed. The payer gets back `max_cost` minus what was actually used, and gas allotted to skipped frames is refunded ([EIP-8141](https://eips.ethereum.org/EIPS/eip-8141)).

The devnet client is explicit about the size of the charge ([ethrex docs](https://github.com/forshtat/ethrex/blob/9aa3645d795945c64400f41a70aace0edfa7f383/docs/eip-8141.md)):

- **A REVERT** is charged its actual `gas_used`.
- **An exceptional halt** (out-of-gas, invalid opcode) is charged the frame's **full `gas_limit`**.
- **Intrinsic gas** is always consumed.

Intrinsic cost is **12,000 plus 475 per frame**, plus signature verification: 2,800 for secp256k1 and 6,700 for P256 ([EIP-8141](https://eips.ethereum.org/EIPS/eip-8141)).

### State gas

Master adds a separate EIP-8037 state-gas pool that meters durable state growth. Execution gas "can never be spent on state charges", and overrunning either pool halts the call ([EIP-8141](https://eips.ethereum.org/EIPS/eip-8141)). This second dimension was added on 2026-08-13, after the devnet pin, so the devnet does not have it ([commit history](https://github.com/ethereum/EIPs/commits/master/EIPS/eip-8141.md)).

### Receipts

The receipt is `[cumulative_gas_used, payer, [[status, gas_used, logs], ...]]`. Per-frame statuses are `0x0` failure, `0x1` success and `0x2` skipped, and any interface that wants a single status has to derive it ([EIP-8141](https://eips.ethereum.org/EIPS/eip-8141)). ethrex reports success only if every frame is `0x1` ([ethrex docs](https://github.com/forshtat/ethrex/blob/9aa3645d795945c64400f41a70aace0edfa7f383/docs/eip-8141.md)).

Atomic batches are the subtle case. When a frame inside a batch fails:

- state rolls back to the start of the batch;
- later frames in the batch are marked `0x2`;
- frames that already ran **keep status `0x1`**, with empty logs and zero state gas ([EIP-8141](https://eips.ethereum.org/EIPS/eip-8141)).

A green `0x1` with empty logs inside a failed batch therefore means "ran, then undone". A failed frame outside any batch reverts on its own, and later frames still run.

### Signature hash

The signature hash is `keccak(0x06 || rlp(tx))` over the whole transaction, **frames included**. Changing any gas limit therefore invalidates the signature. Only the raw bytes of signatures with an empty `msg` are elided: master replaces them with their length, while the devnet pin replaces them with empty bytes ([EIP-8141](https://eips.ethereum.org/EIPS/eip-8141); [@4a9ad32c](https://github.com/ethereum/EIPs/blob/4a9ad32cf2c851d16ab889d643342074ea3fab95/EIPS/eip-8141.md)).

### Status and timeline

EIP-8141 is still a Draft, but ACDE #244 on 2026-08-27 scheduled it for Hegotá with the note "spec may still change" ([Forkcast ACDE #244](https://github.com/ethereum/forkcast/tree/main/public/artifacts/acde/2026-08-27_244)). Hegotá has no activation dates yet ([EIP-8081](https://eips.ethereum.org/EIPS/eip-8081)).

The simulation RPC Readmit relies on, `ethrex_simulateFrameTransaction`, is "an ethrex extension, not a standardized method". It returns `revertData` only on **validation-prefix** failures ([ethrex docs](https://github.com/forshtat/ethrex/blob/9aa3645d795945c64400f41a70aace0edfa7f383/docs/eip-8141.md)). A standard `eth_simulateFrameTransaction` is still only a proposal ([Forkcast AA 2026-09-22](https://github.com/ethereum/forkcast/tree/main/public/artifacts/aa/2026-09-22_005)).

## The alt mempool restores stake and reputation, but the devnet runs older rules

### What ERC-8421 is and why it exists

ERC-8421, "Frame Transaction Alternative Mempools", is a Draft created 2026-09-21 by Weiss, Tirosh, Forshtat and others. Its pull request is still open, needs editor review, and last changed on 2026-10-01 ([ethereum/ERCs PR #2028](https://github.com/ethereum/ERCs/pull/2028); [draft text](https://raw.githubusercontent.com/forshtat/ERCs/refs/heads/pr-clean/ERCS/erc-8421.md)).

Its motivation is the **mass-invalidation attack**. Validation is arbitrary EVM code, so a single state change can invalidate many pending transactions at once. EIP-8141's canonical mempool handles this by banning almost everything. ERC-8421 instead brings back ERC-7562-style staking and reputation, so that ERC-4337 use cases such as token paymasters keep working ([draft](https://raw.githubusercontent.com/forshtat/ERCs/refs/heads/pr-clean/ERCS/erc-8421.md)).

The **entities** it tracks are the sender, the payer (the frame that approves payment) and the factory (the `deploy` frame's target). It also adds a non-static `pre_verify` frame that may run before the approving VERIFY frame.

### How it differs from the canonical mempool

The canonical policy accepts only four prefix shapes, with an optional leading `expiry_verify`: `self_verify`, `deploy → self_verify`, `only_verify → pay`, and `deploy → only_verify → pay` ([EIP-8141](https://eips.ethereum.org/EIPS/eip-8141)).

| Dimension | EIP-8141 canonical | ERC-8421 standard alt mempool |
|---|---|---|
| Validation gas | One combined `MAX_VERIFY_GAS` = 100,000 (prefix execution + signature cost), plus 500,000 state gas | BUDGET-010: per entity, 100,000 unstaked / **1,000,000 staked**; no state-gas cap (solvency covers it) |
| Storage reads | `SLOAD` only on `tx.sender` | Sender's own storage; sender-associated slots in external contracts (STORAGE-021/022); staked entities add own storage, entity-associated read/write, and read-only access to any non-entity contract (STORAGE-031/032/033) |
| BALANCE / SELFBALANCE | Always banned | Allowed for staked entities (OPCODES-010) |
| Non-static prefix frames | None | `pre_verify` allowed |
| Pending txs | One per sender; a non-canonical paymaster gets 1 | 4 per (sender, nonce key), 64 per unstaked sender (LIFECYCLE-030) |
| Staking / reputation | None | Stake about USD 1000 with a 1-day unstake delay and no slashing; `seen`/`included` counters decayed ×23/24 hourly; throttle and ban thresholds of 10 and 50 |

Sources: [EIP-8141](https://eips.ethereum.org/EIPS/eip-8141); [ERC-8421 draft](https://raw.githubusercontent.com/forshtat/ERCs/refs/heads/pr-clean/ERCS/erc-8421.md).

ERC-8421 also **renamed every rule ID** into new families: PREFIX-, BUDGET-, OPCODES-, CREATION-, CALLING-, STORAGE-, ASSOC-, STAKING-, SOLVENCY-, REPUTATION-, LIFECYCLE- and PROPAGATION-. A slot counts as "associated" with address A if its value is A, or if it equals `keccak256(A||x)+n` for n from 0 to 128.

### How the devnet is wired

The devnet has a two-node sidecar in front of one ethrex chain. The sidecar is a fork of Etherspot's Skandha bundler with the EntryPoint removed ([sidecar README](https://github.com/forshtat/mempool-workshop-sidecar); [devnet-readme](https://github.com/forshtat/mempool-workshop-sidecar/blob/master/deploy/devnet/devnet-readme.md)):

- **Gateway** (`altmempoolgateway.forshtat.com`): admits transactions and gossips them to the miner. It never relays to the chain.
- **Miner** (`altmempool.forshtat.com`): admits transactions and relays them to ethrex.

A transaction moves through the system like this:

1. It arrives via `eth_sendFrameTransaction`.
2. The node calls `ethrex_simulateFrameTransaction` with `{trace:true}`.
3. The node applies its own rules to the returned trace. It ignores ethrex's `canonicalMempoolValid` verdict.
4. If the transaction passes, it is admitted and gossiped.
5. Every 10 seconds the miner force-includes pending transactions via the unauthenticated `ethrex_submitPrivilegedFrameTransaction`, "bypassing its own public mempool". It tries up to 3 times before cancelling.
6. A reconciler then marks each transaction `OnChain` or `Reverted`.

The devnet-readme also says a node accepts **only the current on-chain nonce**: there is no queueing of future nonces.

The explorer keeps its history **in memory only**. It is bounded at 10,000 events, cleared on restart and versioned by `bootId`. Detail texts are truncated at 1,024 characters ([sidecar_explorer.md](https://github.com/forshtat/mempool-workshop-sidecar/blob/master/docs/sidecar_explorer.md)). An admission outcome of `accepted` means "in this node's mempool", not "on chain".

### The sidecar enforces a different rule set from ERC-8421

The sidecar implements forshtat/ERCs PR #6, an ERC-7562 update for EIP-8141. The workshop itself calls that rule set "not equivalent" to ERC-8421 ([mempool-workshop](https://github.com/forshtat/mempool-workshop)). Four differences matter for Readmit's explanations.

**The validation gas cap ignores stake.** The `structure` rule sums the entire validation prefix plus signature cost against a hard-coded `MAX_VERIFY_GAS = 100_000`, before stake is ever resolved ([validationPrefix.ts](https://github.com/forshtat/mempool-workshop-sidecar/blob/master/packages/executor/src/services/UserOpValidation/utils/validationPrefix.ts)). The devnet README's claim of a 1M staked budget is wrong against the code. The fix (sidecar PR #3) was opened 2026-11-06 and is unreviewed, and ethrex would still enforce the combined 100k cap on its own path ([PR #3](https://github.com/forshtat/mempool-workshop-sidecar/pull/3)).

**`COD-010` means something else here.** In the sidecar it means "accessed an undeployed address", which is ERC-7562 OP-041 or ERC-8421 CALLING-010. It does not mean ERC-7562's "code hash changed between validations". An open issue reports that the gateway's empty `precompiles` list makes even an `ecrecover` call fail under this label ([frameTx.ts](https://github.com/forshtat/mempool-workshop-sidecar/blob/master/packages/executor/src/services/UserOpValidation/validators/frameTx.ts); [issue #1](https://github.com/forshtat/mempool-workshop/issues/1)).

**`OP-011` covers BALANCE.** The sidecar's `OP-011` ("banned opcode") list includes BALANCE and SELFBALANCE. They are waived only when stake is **strictly greater** than `minStake`, and the unstake delay is not checked.

**Two storage messages mean different things.** `unstaked <role> accessed …` means the access would pass if that entity were staked. `<role> has forbidden write to …` fails even when the entity is staked.

Staking on the devnet goes through a naive registry at `0xd51c…2d2f`. It is keyed by `msg.sender`, so a paymaster contract must call `addStake` itself ([devnet-readme](https://github.com/forshtat/mempool-workshop-sidecar/blob/master/deploy/devnet/devnet-readme.md)).

## Prior tools diagnose failures well but stop before the fix

### What existing tools do

Tenderly shows the failing line, profiles gas per function, and lets a developer re-simulate with edited parameters or edited source ([Tenderly docs](https://docs.tenderly.co/debugger/execution-overview)). Phalcon's simulator re-runs a transaction at any block position with editable inputs ([BlockSec docs](https://docs.blocksec.com/phalcon/phalcon-explorer/simulator)).

For ERC-4337 user operations, debugging is a manual recipe:

- **ZeroDev's Tenderly recipe** requires setting "From" to the EntryPoint and works only for already-deployed accounts ([ZeroDev](https://docs.zerodev.app/sdk/v5_3_x/faqs/debug-userop)).
- **Pimlico's dashboard** prefills a simulation, links out to Tenderly, and falls back to `cast call --trace` ([Pimlico](https://docs.pimlico.io/guides/how-to/debugging/user-operations)).
- **The 2026 Wavect debugger** decodes user operations and explains AA errors, but does not execute, suggest gas or send ([Wavect](https://wavect.io/es/tools/erc-4337-useroperation-debugger/)).

### Where the gas advice ends

When the tools do give advice, it is vague:

- **Candide's AA error codes** say "increase verificationGasLimit" with no number ([Candide](https://docs.candide.dev/wallet/technical-reference/entrypoint-error-codes/)).
- **MetaMask's guidance** says "perhaps doubling" the limit ([MetaMask](https://docs.metamask.io/smart-accounts-kit/troubleshooting/user-operation-reverted/)).
- **Alchemy's overrides** are a static multiplier you configure ahead of time ([Alchemy](https://www.alchemy.com/blog/user-operation-overrides)).

### Why this pain is real

The 4337 error codes themselves blur "reverted" and "out of gas": AA13 "initCode failed or OOG", AA23 "reverted (or OOG)", AA33 "rejected or ran out of gas" ([Candide](https://docs.candide.dev/wallet/technical-reference/entrypoint-error-codes/); [Pimlico AA23](https://docs.pimlico.io/infra/bundler/entrypoint-errors/aa23)). Mempool rejections come back as JSON-RPC codes such as `-32502`, an ERC-7562 opcode violation, and never reach the chain, so explorers cannot show them ([EIP-7769](https://eips.ethereum.org/EIPS/eip-7769)).

### Frame-transaction tooling today

Tooling for 0x06 transactions is still early:

- viem has only a draft pull request for 0x06 encoding ([viem #4486](https://github.com/wevm/viem/pull/4486)).
- Ethernal has described how explorers *should* render frame receipts, but has not confirmed shipping it ([Ethernal blog](https://tryethernal.com/blog/eip-8141-frame-transactions-eoa-abstraction)).

### How Readmit differs

The honest positioning is **not** "Tenderly can't debug AA". It can, with manual setup. Readmit's differences are:

1. **It is frame-native.** It names the failed frame of a 0x06 transaction, which no tool found does.
2. **It is prescriptive.** It gives a concrete gas number, dry-runs it, re-signs and resends.
3. **It explains mempool rejections.** It surfaces the sidecar's rejection rule, which, like a 4337 `-32502` error, never reaches the chain.

### The out-of-gas heuristic and the 1.25× fix

Readmit flags a frame as out-of-gas when it used at least 98% of its limit. That is a defensible relaxation of the standard "gasUsed equals limit" signal ([Foundry](https://www.getfoundry.sh/guides/debugging-transactions)). Under EIP-150 a caller keeps 1/64 of its gas when it makes a call, about 1.56% ([RareSkills](https://rareskills.io/?p=2630)). So an inner call that runs out of gas, followed by an outer revert, tends to land just above 98%.

The heuristic has known failure modes:

- **Gas-burning failures look like out-of-gas.** INVALID-opcode failures, and a STATICCALL that tries to write state, burn all forwarded gas ([Sherlock #822](https://github.com/sherlock-audit/2023-06-tokemak-judging/issues/822)).
- **Some contracts catch an inner out-of-gas and revert with a custom error**, which hides the gas cause ([Pyth PR #3106](https://github.com/pyth-network/pyth-crosschain/pull/3106.diff)).
- **No published source validates 98% specifically.**

The mitigation is the dry-run: a mislabelled failure still fails the retry.

The 1.25× headroom also has no standard behind it. It sits between the 1.2 factor some AA SDKs use and MetaMask's 1.5× ([Ethereum Magicians](https://ethereum-magicians.org/t/improving-gasestimation/3907); [SDK gasBuffer](https://abstract-docs.vercel.app/sdk-reference/bundler-client/methods/more/prepareUserOperationWithoutSignature)).

## Pricing from slot0 is allowed only because the paymaster is staked

### How the price is read

`StateLibrary.getSlot0` makes a single `extsload` of the PoolManager slot `keccak256(poolId, 6)` and unpacks `sqrtPriceX96`, tick, protocol fee and LP fee ([v4-core StateLibrary.sol](https://raw.githubusercontent.com/Uniswap/v4-core/main/src/libraries/StateLibrary.sol)). It is the instantaneous price after the last swap, with no time component. That is exactly the "spot price" the oracle-manipulation literature warns about: borrow, push the pool, read the price, unwind, all in one block ([Chainscore Labs](https://www.chainscorelabs.com/blog/security-post-mortems-hacks-and-exploits/oracle-manipulation-attacks/why-time-weighted-average-prices-twaps-are-not-a-silver-bullet)). Uniswap's own guide notes that manipulating liquidity is "orders of magnitude" cheaper than manipulating price ([Uniswap oracle guide](http://developers.uniswap.org/llms.mdx/docs/sdks/v3/guides/price-oracle)).

### Why the paymaster lives in the alt mempool

In the EIP-8141 public mempool, a paymaster cannot read the PoolManager at all, because `SLOAD` is limited to `tx.sender` ([EIP-8141](https://eips.ethereum.org/EIPS/eip-8141)). In the ERC-8421 alt mempool, a **staked** entity gets read-only access to any non-entity contract's storage ([ERC-8421 draft](https://raw.githubusercontent.com/forshtat/ERCs/refs/heads/pr-clean/ERCS/erc-8421.md); [ERC-7562 STO-033](https://eips.ethereum.org/EIPS/eip-7562)). That is the honest answer to "why not the canonical mempool?": the canonical policy cannot price an ERC-20.

### Exposure is bounded but real

Each sponsored transaction's loss is bounded by its gas cost, and the 10% markup absorbs downward manipulation of up to about 9.1% (1 − 1/1.1). That arithmetic is our own inference, not a sourced figure. On a thin test "tUSD" pool, manipulation is nearly free. The risk grows when a builder or attacker packs many sponsored transactions behind a single price move, because the builder controls ordering at inclusion. EIP-8141's own ERC-20 sponsor example accepts some front-running risk, and it advises paymasters to bound their exposure against `max_fee` ([EIP-8141](https://eips.ethereum.org/EIPS/eip-8141)).

### Invalidation is the bigger operational problem

Under ERC-8421 LIFECYCLE-040, every block in which the pool trades forces nodes to revalidate pending transactions that depend on that slot ([ERC-8421 draft](https://raw.githubusercontent.com/forshtat/ERCs/refs/heads/pr-clean/ERCS/erc-8421.md)). Suppose the next frame must transfer *exactly* the slot0-derived amount. Then every price move invalidates every pending transaction, `seen` grows while `included` does not, and the paymaster drifts toward THROTTLED or BANNED. This is an inference. The notes did not confirm whether ERC-8421 blames the paymaster for failures caused by a third-party swap.

### Alternatives and how they fare in validation

| Option | Validation-safe (staked, alt mempool)? | Catch |
|---|---|---|
| `slot0` via `extsload` | Yes | Manipulable within a block; heavy on invalidation |
| TWAP `observe(secondsAgos)` (v3 or the GeomeanOracle hook) | Not as a live call | Depends on `block.timestamp`, which is banned in validation; the GeomeanOracle hook also needs a full-range, zero-fee pool with liquidity that can never be removed ([GeomeanOracle.sol](https://raw.githubusercontent.com/Uniswap/v4-periphery/example-contracts/contracts/hooks/examples/GeomeanOracle.sol)) |
| Chainlink feed read | The storage read is allowed | The staleness check needs TIMESTAMP; express it as a validity window instead |
| Cached price, refreshed in post-op | Yes, and the safest option | The pattern of eth-infinitism's TokenPaymaster, which says the token price "cannot be queried in the validation code" ([TokenPaymaster.sol](https://github.com/eth-infinitism/account-abstraction/blob/v0.7.0/contracts/samples/TokenPaymaster.sol)). In EIP-8141 the refresh must happen in a DEFAULT post-op frame, because VERIFY is a STATICCALL |

Pimlico's ERC-20 paymaster reads a live oracle in validation, and relies on stake and a staleness threshold to do so ([Pimlico ERC20PaymasterV07](https://raw.githubusercontent.com/pimlicolabs/erc20-paymaster/main/src/ERC20PaymasterV07.sol)).

### A defensible hybrid

This is an inference, not a sourced design. Keep `slot0` as the live source, then:

1. Clamp it to a band around a price cached in the post-op frame.
2. Have the user sign a maximum token amount.
3. Accept `transfer >= quote` and refund the surplus in post-op.
4. Cap sponsorship using `max_fee`.

Small price moves then no longer invalidate pending transactions, and the paymaster's loss is capped at the band plus the markup.

### Fit with the Uniswap prize

Recent Uniswap Foundation prizes at ETHGlobal accept any integration with the Uniswap stack. They require a FEEDBACK.md file, the developer feedback form, and a README that points to the exact contracts and lines of code ([ETHOnline 2026](https://ethglobal.com/events/ethonline2026/prizes/uniswap-foundation)). A paymaster that only reads a pool is a shallow integration by those standards.

## Claims a builder of this tool must get right

| Readmit claim | Verdict | What the research says |
|---|---|---|
| VERIFY = mode 1, SENDER = mode 2 ("user operation") | **Supported** | These are the only valid modes besides DEFAULT = 0, and the spec's mempool section calls SENDER `user_op`. Readmit must also render DEFAULT frames (`deploy`, `post_op`) ([EIP-8141](https://eips.ethereum.org/EIPS/eip-8141)) |
| `flags & 1` = approve payment, `flags & 2` = approve execution | **Supported in code, refined in wording** | The masks match the spec. Avoid saying "bit 1 / bit 2": the spec counts bits from zero, and bit 2 (`0x4`) is ATOMIC_BATCH. Flags only *allow* a scope; `APPROVE` grants it ([EIP-8141](https://eips.ethereum.org/EIPS/eip-8141)) |
| Frame status `0x1` success, `0x0` failed, `0x2` skipped | **Supported, refined** | Frames that ran before a failure inside an atomic batch keep `0x1` but are rolled back and have empty logs. Show them as "ran, undone". There is no transaction-level status ([EIP-8141](https://eips.ethereum.org/EIPS/eip-8141)) |
| "The payer was charged anyway" when a frame fails | **Supported with conditions** | True only for execution-body frames after a payer was set. A failed VERIFY frame, or no payer at all, makes the transaction invalid: it never lands and nobody pays. On the devnet, a halt is charged the full frame limit and a revert its actual usage. Name the payer from the receipt, not the sender ([EIP-8141](https://eips.ethereum.org/EIPS/eip-8141); [ethrex docs](https://github.com/forshtat/ethrex/blob/9aa3645d795945c64400f41a70aace0edfa7f383/docs/eip-8141.md)) |
| Out-of-gas when used ≥ 98% of the frame limit | **Refined** | A reasonable relaxation of "used = limit", consistent with the 1/64 rule, but it is Readmit's own heuristic and has no published validation. It mislabels all-gas-burning failures and hides caught out-of-gas errors. The trace and the dry-run are the ground truth ([Foundry](https://www.getfoundry.sh/guides/debugging-transactions); [RareSkills](https://rareskills.io/?p=2630); [Pyth #3106](https://github.com/pyth-network/pyth-crosschain/pull/3106.diff)) |
| Suggest used × 1.25, rounded up to 1,000 | **Refined** | There is no standard; industry practice ranges from 1.2× to 1.5× to "double it". For prefix frames the fix must also stay under the combined 100k validation cap, or the sidecar rejects it under `structure` (our inference) ([Magicians](https://ethereum-magicians.org/t/improving-gasestimation/3907); [validationPrefix.ts](https://github.com/forshtat/mempool-workshop-sidecar/blob/master/packages/executor/src/services/UserOpValidation/utils/validationPrefix.ts)) |
| Fix & send must re-sign | **Supported** | The signature hash covers every frame, so any change to a gas limit invalidates the old signature ([EIP-8141](https://eips.ethereum.org/EIPS/eip-8141)) |
| The resend needs the right nonce | **Supported (implication)** | A failure that landed on chain bumped the nonce at payment approval. An invalid transaction did not. The devnet accepts only the current on-chain nonce ([EIP-8141](https://eips.ethereum.org/EIPS/eip-8141); [devnet-readme](https://github.com/forshtat/mempool-workshop-sidecar/blob/master/deploy/devnet/devnet-readme.md)) |
| The sidecar caps validation at 100k even for staked entities, while ERC-8421 allows 1M | **Supported, refined** | ERC-8421's 1M is **per entity**. The sidecar's 100k is one combined cap. The fix PR is open and unmerged, and the devnet README misdescribes the code ([PR #3](https://github.com/forshtat/mempool-workshop-sidecar/pull/3)) |
| Canonical forbids non-sender storage; the alt mempool allows it when staked | **Supported, refined** | `StorageReadNonSender` is ethrex's name for the violation, not a spec rule ID. Unstaked entities may also read *sender-associated* slots, such as an ERC-20 `balanceOf[sender]` ([ERC-8421 draft](https://raw.githubusercontent.com/forshtat/ERCs/refs/heads/pr-clean/ERCS/erc-8421.md); [frameTx.ts](https://github.com/forshtat/mempool-workshop-sidecar/blob/master/packages/executor/src/services/UserOpValidation/validators/frameTx.ts)) |
| Showing the sidecar rule IDs (`OP-011`, `COD-010`) as "ERC-8421 rules" | **Contradicted** | These are ERC-7562-era labels, and the sidecar's `COD-010` actually means CALLING-010 / OP-041 (undeployed address), not "code hash changed" ([sidecar_explorer.md](https://github.com/forshtat/mempool-workshop-sidecar/blob/master/docs/sidecar_explorer.md); [ERC-7562](https://eips.ethereum.org/EIPS/eip-7562)) |
| "Admitted" status | **Refined** | It means the node's admission outcome is `accepted`: the transaction is in that node's mempool, not on chain. Explorer history is in memory and can vanish on restart ([sidecar_explorer.md](https://github.com/forshtat/mempool-workshop-sidecar/blob/master/docs/sidecar_explorer.md)) |
| Replaying a failure shows the revert reason, or says plainly why it can't | **Supported** | `ethrex_simulateFrameTransaction` returns `revertData` only on validation-prefix failures, so an execution-frame failure has no reason to show. It is a non-standard ethrex RPC ([ethrex docs](https://github.com/forshtat/ethrex/blob/9aa3645d795945c64400f41a70aace0edfa7f383/docs/eip-8141.md)) |
| No other tool debugs frame transactions or proposes and sends a gas fix | **Supported (absence of evidence)** | No tool was found doing either. viem has only a draft and Ethernal only a design post. The tools found stop at diagnosis or a static multiplier ([viem #4486](https://github.com/wevm/viem/pull/4486); [Ethernal](https://tryethernal.com/blog/eip-8141-frame-transactions-eoa-abstraction)) |
| The slot0 paymaster is safe because it is staked | **Refined** | Stake makes the read *admissible*, not safe. It stays manipulable within a block and causes heavy invalidation. Defend it with the markup, `max_fee` caps and a signed maximum amount ([ERC-8421 draft](https://raw.githubusercontent.com/forshtat/ERCs/refs/heads/pr-clean/ERCS/erc-8421.md); [EIP-8141](https://eips.ethereum.org/EIPS/eip-8141)) |

## Facts found by checking the repo/devnet directly

The team verified the following directly. They are not drawn from published sources.

**The FrameGas repository exists.** [github.com/amityadav0/framegas](https://github.com/amityadav0/framegas) was created on 2026-11-05. It describes an EIP-8141 paymaster, priced on Uniswap v4, that the ERC-8421 alt mempool admits on chain 1337. This settles a gap in the research notes, whose web and ETHGlobal searches had not found the project.

**Readmit's flag masks match the spec.** Readmit's code tests `flags & 1` for payment approval and `flags & 2` for execution approval, which matches the spec's `0x1` and `0x2` scope values.

**A live replay showed no revert reason, as expected.** Failed transaction `0x5f29af86…` was replayed with `ethrex_simulateFrameTransaction` on its parent block. The result had `executionStatus` "reverted", frame 3 with `succeeded: false`, and **no `revertData` field**. That matches the ethrex documentation, which emits `revertData` only for validation-prefix failures. So Readmit is right to say plainly that no reason is available for an execution-body failure.

## Glossary

**Frame transaction (type `0x06`):** An EIP-8141 transaction made of up to 64 frames, each with its own mode, target, gas and data.

**DEFAULT / VERIFY / SENDER:** Frame modes 0, 1 and 2. DEFAULT and VERIFY run as `ENTRY_POINT` (`0xaa`); VERIFY is static and can only `APPROVE`. SENDER runs as `tx.sender` after execution approval.

**APPROVE (opcode `0xaa`):** Ends a frame and grants a scope: payment (`0x1`), execution (`0x2`) or both (`0x3`). The frame's flags must permit that scope.

**Payer:** The address that approved payment. `max_cost` is collected from it at approval time, and the receipt records it. It may differ from the sender.

**Validation prefix / execution body:** The frames up to and including the one that sets the payer, and the frames after it.

**Atomic batch:** A contiguous run of frames chained by `ATOMIC_BATCH_FLAG` (`0x4`). If one fails, all of them roll back.

**State gas:** The EIP-8037 second gas dimension, which meters durable state growth. It is in master but not in the devnet pin.

**sig_hash:** `keccak(0x06 || rlp(tx))` over the full transaction, frames included.

**Canonical mempool:** EIP-8141's strict public mempool policy, with no stake and no reputation.

**ERC-8421 / alt mempool:** The draft standard for opt-in alternative mempools that bring back stake, reputation and wider validation rules.

**ERC-7562:** The ERC-4337 validation-scope rules. It is the origin of the OP-, STO- and COD- rule IDs.

**Entity:** The sender, payer or factory whose validation behaviour is policed and whose reputation is tracked.

**Staked:** Holds at least `MIN_STAKE_VALUE` with an unstake delay of at least the minimum and no withdrawal pending. On the devnet, stake must be strictly greater than `minStake`.

**Mass invalidation:** One state change that invalidates many pending transactions at once.

**Sidecar:** The Skandha-fork node that simulates, admits, gossips and (on the miner) privileged-submits frame transactions.

**slot0 / sqrtPriceX96:** A Uniswap v4 pool's packed spot-price word, and the square root of the price in Q64.96 fixed point.

**TWAP:** Time-weighted average price. It resists single-block manipulation but needs a timestamp.

## Conclusion

Readmit's value comes from a structural fact, not a feature list. EIP-8141 deliberately has no transaction-level status, and it moves validation into arbitrary EVM code that mempools must police. Failure therefore becomes a two-layer question: which frame failed on chain, and which mempool rule rejected the transaction off chain. Existing tools answer neither layer for frames. Readmit's strongest pitch is that it answers both and then closes the loop with a re-signed resend.

Its biggest credibility risk is conflating layers. The spec, the ERC-8421 draft and the running sidecar disagree on the gas budget, on what COD-010 means, and on how strictly BALANCE is treated. A tool that names its source on every explanation turns that instability into a demo strength: it shows judges exactly where the ecosystem's own documentation is wrong today.

The paymaster story holds up best when it concedes that stake makes reading a v4 pool *admissible*, not *safe*, and then shows the caps that bound the damage.
