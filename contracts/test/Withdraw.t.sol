// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {Test} from "forge-std/Test.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolId} from "v4-core/src/types/PoolId.sol";
import {TestERC20} from "v4-core/src/test/TestERC20.sol";
import {V4PricedPaymaster} from "../src/V4PricedPaymaster.sol";

contract WithdrawTest is Test {
    TestERC20 t;
    V4PricedPaymaster p;
    address payable to = payable(address(0xBEEF));

    function setUp() public {
        t = new TestERC20(1e15);
        p = new V4PricedPaymaster{value: 1 ether}(IPoolManager(address(1)), PoolId.wrap(bytes32(0)), address(t));
        t.transfer(address(p), 5e6);
    }

    function test_ownerWithdraws() public {
        p.withdraw(to, 0.4 ether, 5e6);
        assertEq(to.balance, 0.4 ether);
        assertEq(t.balanceOf(to), 5e6);
        assertEq(address(p).balance, 0.6 ether);
    }

    function test_nonOwnerCannotWithdraw() public {
        vm.prank(address(0xBAD));
        vm.expectRevert(bytes("not owner"));
        p.withdraw(to, 1, 0);
    }
}
