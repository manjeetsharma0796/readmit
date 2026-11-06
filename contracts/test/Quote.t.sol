// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {Test} from "forge-std/Test.sol";
import {SetupPool} from "../script/SetupPool.s.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {ModifyLiquidityParams, SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {TestERC20} from "v4-core/src/test/TestERC20.sol";
import {PoolModifyLiquidityTest} from "v4-core/src/test/PoolModifyLiquidityTest.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {V4PricedPaymaster} from "../src/V4PricedPaymaster.sol";

contract QuoteTest is Test {
    using PoolIdLibrary for PoolKey;
    receive() external payable {}
    function test_quoteTracksPool() public {
        IPoolManager pm = IPoolManager(0x6bF9Aa9c04fd001385742d61f6818C3236429848);
        vm.deal(address(this), 100 ether);
        TestERC20 t = new TestERC20(1e15);
        PoolKey memory key = PoolKey(Currency.wrap(address(0)), Currency.wrap(address(t)), 3000, 60, IHooks(address(0)));
        pm.initialize(key, 4339505179874779489431521);
        PoolModifyLiquidityTest lp = new PoolModifyLiquidityTest(pm);
        PoolSwapTest sw = new PoolSwapTest(pm);
        t.approve(address(lp), type(uint256).max);
        lp.modifyLiquidity{value: 10 ether}(key, ModifyLiquidityParams(-887220, 887220, 1e12, 0), "");
        V4PricedPaymaster p = new V4PricedPaymaster(pm, key.toId(), address(t));
        uint256 q0 = p.quote(1e15);
        assertApproxEqRel(q0, 3_300_000, 0.01e18); // 0.001 ETH gas ~ 3.3 tUSD at 1 ETH = 3000
        sw.swap{value: 1 ether}(key, SwapParams(true, -1 ether, TickMath.MIN_SQRT_PRICE + 1), PoolSwapTest.TestSettings(false, false), "");
        uint256 q1 = p.quote(1e15);
        assertLt(q1, q0); // ETH sold into pool -> ETH cheaper -> fewer tUSD owed
        // MovePrice direction (zeroForOne=false): tUSD sold in -> ETH pricier -> more tUSD owed -> old signatures underpaid
        t.approve(address(sw), type(uint256).max);
        sw.swap(key, SwapParams(false, -10_000e6, TickMath.MAX_SQRT_PRICE - 1), PoolSwapTest.TestSettings(false, false), "");
        assertGt(p.quote(1e15), q1);
    }
}
