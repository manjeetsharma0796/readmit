# Uniswap developer feedback: Readmit (ETHGlobal Mumbai 2026)

Readmit is a debugger for EIP-8141 frame transactions. Part of it is a gas paymaster, `V4PricedPaymaster`, that lets a wallet with 0 ETH pay gas in a test stablecoin (tUSD). While the transaction is being validated, the paymaster reads the price of our ETH/tUSD Uniswap v4 pool and only agrees to pay the ETH gas if the next frame sends it enough tUSD.

We built this on the EF alt-mempool devnet (chain 1337). Uniswap v4 is predeployed there, but no Uniswap API or SDK supports that chain, so we worked straight against v4-core with Foundry. Everything below comes from building and running it, not from reading about it.

Code: [`contracts/src/V4PricedPaymaster.sol`](contracts/src/V4PricedPaymaster.sol) (`quote()` is lines 45-49) and [`contracts/script/SetupPool.s.sol`](contracts/script/SetupPool.s.sol). The README section "Uniswap integration" links every line we use.

## What worked well

- Reading the price was one call. `StateLibrary.getSlot0` reads the pool straight from `PoolManager` storage, with no hook, no callback and no router. It was the only Uniswap call our validation code needed.
- Native ETH as `currency0` (address 0) meant no WETH anywhere in the flow.
- With the singleton `PoolManager`, creating a pool is just `initialize` with a `PoolKey`. On a devnet where every deploy is expensive, two cheap transactions (`initialize` at 133,755 gas and `modifyLiquidity` at 950,240 gas) got us a working pool.
- `PoolModifyLiquidityTest` and `PoolSwapTest` from v4-core let us add liquidity and move the price from a Foundry script in minutes. The router refunds unused ETH, so sending a bit too much `msg.value` was harmless.

## Where we lost time, worst first

1. **Which v4-core version to install.** `forge install uniswap/v4-core` gave us the `v4.0.0` tag, and the current examples don't compile against it: `src/types/PoolOperation.sol` (`ModifyLiquidityParams`, `SwapParams`) only exists on `main`. We ended up on `uniswap/v4-core@main`. The npm package (1.0.2) is a third version again. One line in the docs saying which ref matches the current examples would have saved us real time.

2. **There is no price that is safe to read during validation.** `slot0` is a spot price and can move within a block. For us that showed up twice:
   - The alt mempool only admits a paymaster that reads `PoolManager` storage during validation if the paymaster is staked. Without a stake the transaction is rejected as `StorageReadNonSender`.
   - A transaction signed at one price can be refused as "underpaid" if a swap raises the price before it is included. A swap that lowers the price is harmless, which took us a while to describe correctly.

   We used the spot price plus a 10% markup, and the app re-quotes on every send. A small helper or reference oracle hook that gives a bounded or time-weighted price, aimed at paymasters, would make Uniswap the obvious place to price gas for account abstraction (ERC-4337 paymasters and EIP-8141 VERIFY frames have the same problem).

3. **`sqrtPriceX96` math with mixed decimals.** Turning `sqrtPriceX96` into "how much tUSD for N wei" for an 18-decimal / 6-decimal pair took two `FullMath.mulDiv` calls and a unit test before it was right. A documented helper such as `quoteFromSqrtPrice(amount0, sqrtPriceX96)` in `StateLibrary` or periphery would remove a common source of bugs.

4. **Test router bytecode is large.** Deploying `PoolSwapTest` cost 15,858,168 gas and `PoolModifyLiquidityTest` cost 14,890,804. This devnet charges state gas for code, so both were close to the 16,777,216 per-transaction cap. Slimmer test routers would help on chains that price state.

5. **How much liquidity is `1e13`?** We asked for `liquidity = 1e13` full range and had to work out by hand that it uses about 0.18 ETH and 548 tUSD at 1 ETH = 3000 tUSD. A `LiquidityAmounts` example in the v4-core quickstart, not only in periphery, would help.

6. **No supported path on a custom chain.** The Trading API and the SDK chain configs don't include chain 1337. On a devnet the options are hand-encoding `UniversalRouter` commands with Permit2, or the v4-core test routers. We used the test routers. A documented way to point the v4 SDK at your own chain would help hackathon teams on devnets.

## What we would like next

- A validation-safe price read (bounded or TWAP) for paymasters.
- The `sqrtPriceX96` quote helper from point 3.
- A clear "install this ref" note for v4-core.

## Numbers from our deployment (chain 1337)

- `PoolManager.initialize`: tx `0x82c3ce8a…ffdba`, block 5,999, 133,755 gas.
- `modifyLiquidity` (full range, L = 1e13): tx `0xe5f01d41…3d0`, block 6,004, 950,240 gas.
- Paymaster `quote(0.001 ETH)` = 3,299,998, i.e. 3.30 tUSD (1 ETH = 3000 tUSD, plus 10%).
- First frame transaction paid in tUSD: `0x3fd93ca4…4b9c`, block 6,065. The fee was 2.969998 tUSD, and the paymaster's VERIFY frame, including the `getSlot0` read, used 52,848 gas.
