// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {ModifyLiquidityParams, SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {TestERC20} from "v4-core/src/test/TestERC20.sol";
import {PoolModifyLiquidityTest} from "v4-core/src/test/PoolModifyLiquidityTest.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {V4PricedPaymaster, IStakingRegistry} from "../src/V4PricedPaymaster.sol";

/// forge script script/SetupPool.s.sol --rpc-url $RPC --private-key $PK --broadcast
contract SetupPool is Script {
    using PoolIdLibrary for PoolKey;
    IPoolManager constant PM = IPoolManager(0x6bF9Aa9c04fd001385742d61f6818C3236429848); // devnet 1337, re-read 1337.json after resets
    IStakingRegistry constant REG = IStakingRegistry(0xD51c04d7A0B01124E84DE152F4e56d9eeCB22D2F);

    function run() external {
        vm.startBroadcast();
        TestERC20 tusd = new TestERC20(1e15);                 // 1B tUSD (6-dec semantics), minted to deployer
        PoolKey memory key = PoolKey(Currency.wrap(address(0)), Currency.wrap(address(tusd)), 3000, 60, IHooks(address(0)));
        PM.initialize(key, 4339505179874779489431521);         // 1 ETH = 3000 tUSD (raw units)
        PoolModifyLiquidityTest lp = new PoolModifyLiquidityTest(PM);
        PoolSwapTest swapper = new PoolSwapTest(PM);
        tusd.approve(address(lp), type(uint256).max);
        tusd.approve(address(swapper), type(uint256).max);
        lp.modifyLiquidity{value: 0.25 ether}(key, ModifyLiquidityParams(-887220, 887220, 1e13, 0), ""); // uses ~0.18 ETH + ~548 tUSD; the router refunds the rest
        // Deployed UNSTAKED on purpose: demo step 1 is "unstaked paymaster rejected (storage)". Stake with StakePaymaster.
        V4PricedPaymaster pmr = new V4PricedPaymaster{value: 0.3 ether}(PM, key.toId(), address(tusd)); // pays users' gas
        console.log("tUSD", address(tusd)); console.log("paymaster", address(pmr)); console.log("swapper", address(swapper));
        vm.stopBroadcast();
        // The app and scripts read addresses from here (AGENTS.md section 6). tUSD uses 6-decimal semantics.
        string memory j = "d";
        vm.serializeUint(j, "chainId", block.chainid);
        vm.serializeAddress(j, "tUSD", address(tusd));
        vm.serializeUint(j, "tUSDDecimals", 6);
        vm.serializeAddress(j, "paymaster", address(pmr));
        vm.serializeBytes32(j, "poolId", PoolId.unwrap(key.toId()));
        vm.serializeAddress(j, "swapper", address(swapper));
        vm.serializeBool(j, "paymasterStaked", false);
        vm.writeJson(vm.serializeUint(j, "deployBlock", block.number), "deployments/1337.json");
    }
}

/// Demo step 2: stake the paymaster (registry keys off msg.sender = the paymaster contract).
contract StakePaymaster is Script {
    IStakingRegistry constant REG = IStakingRegistry(0xD51c04d7A0B01124E84DE152F4e56d9eeCB22D2F);
    function run(V4PricedPaymaster pmr) external {
        vm.startBroadcast();
        pmr.stake{value: 0.012 ether}(86400, REG);              // devnet minStake 0.01 ETH; BALANCE carve-out needs strict >
        vm.stopBroadcast();
    }
}

/// The "state moved under you" trigger. zeroForOne=false: sell tUSD for ETH -> ETH gets pricier in tUSD ->
/// quote(maxCost) rises -> pending txs that signed a transfer near the old quote now fail VERIFY ("underpaid").
/// Must be broadcast by the SetupPool deployer (holds tUSD, already approved the swapper).
contract MovePrice is Script {
    function run(PoolSwapTest swapper, address tusd, int256 tusdIn) external { // tusdIn negative = exact-in
        vm.startBroadcast();
        PoolKey memory key = PoolKey(Currency.wrap(address(0)), Currency.wrap(tusd), 3000, 60, IHooks(address(0)));
        swapper.swap(key, SwapParams(false, tusdIn, TickMath.MAX_SQRT_PRICE - 1), PoolSwapTest.TestSettings(false, false), "");
        vm.stopBroadcast();
    }
}
