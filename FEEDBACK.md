# Uniswap developer feedback: Readmit, ETHGlobal Mumbai 2026

**What we built:** a gas paymaster for EIP-8141 frame transactions. During transaction validation, the paymaster prices gas from a Uniswap v4 ETH/tUSD pool (`StateLibrary.getSlot0`), so a wallet holding 0 ETH can pay gas in tUSD.

**Where:** the EF alt-mempool devnet (chain 1337). Uniswap v4 is predeployed there, but no Uniswap API or SDK supports that chain. Everything below is from building and running this, not from reading.

## What worked well
- **`StateLibrary.getSlot0` / `extsload` is exactly right for this.** A contract can read a pool's price straight from `PoolManager` storage, with no hook, no callback and no router. It was the only Uniswap call our validation code needed.
- **Native ETH as `currency0` (address 0)** removed WETH wrapping from the whole flow.
- **The singleton PoolManager meant that "deploy a pool" is just `initialize` with a `PoolKey`.** On a devnet where every contract deploy is expensive, only needing `initialize` + `modifyLiquidity` (two cheap txs: 133,755 and 950,240 gas) was a big win.
- **`PoolModifyLiquidityTest` / `PoolSwapTest` in v4-core** let us seed liquidity and move the price from a Foundry script in minutes. The router also refunds unused ETH, so over-sending `msg.value` is safe.

## Friction we hit, in the order it cost us time
1. **`forge install uniswap/v4-core` gets the `v4.0.0` tag, which doesn't match current imports.** `src/types/PoolOperation.sol` (`ModifyLiquidityParams`, `SwapParams`) only exists on `main`. We had to use `forge install uniswap/v4-core@main`. The npm-published v4-core (1.0.2) is a third version. A note in the docs about which ref matches the current examples would have saved us real time.
2. **No validation-safe price.** `slot0` is a spot price that can move within a block. Validation code (ERC-4337 paymasters, EIP-8141 VERIFY frames) needs a bounded or TWAP price, and v4 core has no built-in oracle. We used spot price plus a 10% markup, with a cap-and-requote flow in the app. A small "read a bounded price" helper or reference oracle hook aimed at paymasters would make Uniswap the default gas-pricing source for account abstraction.
3. **Price math for mixed decimals.** Going from `sqrtPriceX96` to "tUSD owed for N wei" for an 18-decimal / 6-decimal pair took two `FullMath.mulDiv` calls and a unit test to get right. A documented `StateLibrary` or periphery helper (for example `quoteFromSqrtPrice(amount0, sqrtPriceX96)`) would remove a common bug source.
4. **Large test-router bytecode on gas-metered devnets.** Deploying `PoolSwapTest` cost 15,858,168 gas and `PoolModifyLiquidityTest` 14,890,804 gas. On this devnet (state gas for code), that's close to the 16,777,216 per-transaction cap. A slimmer swap/liquidity test router would help chains with state-gas pricing.
5. **Liquidity amounts aren't obvious.** We asked for `liquidity = 1e13` full-range and had to work out by hand that it uses about 0.18 ETH and about 548 tUSD at 1 ETH = 3000 tUSD. A `LiquidityAmounts` example inside the v4-core quickstart (not only in periphery) would help.
6. **No SDK, API or Router path for custom chains.** The Trading API and SDK chain configs don't cover chain 1337. On a devnet the only options are hand-encoded `UniversalRouter` commands with Permit2, or the v4-core test routers. We used the test routers. A documented "bring your own chain" config for the v4 SDK would help hackathon devnets.

## Numbers from our deployment (chain 1337)
- `PoolManager.initialize`: tx `0x82c3ce8a…ffdba`, block 5,999, 133,755 gas.
- `modifyLiquidity` (full range, L = 1e13): tx `0xe5f01d41…3d0`, block 6,004, 950,240 gas.
- Paymaster `quote(0.001 ETH)` = 3,299,998, i.e. 3.30 tUSD (1 ETH = 3000 tUSD, plus 10%).
- A frame tx paid in tUSD: `0x3fd93ca4…4b9c`. The fee was 2.969998 tUSD, and the paymaster's VERIFY frame (including the `getSlot0` read) used 52,848 gas.
