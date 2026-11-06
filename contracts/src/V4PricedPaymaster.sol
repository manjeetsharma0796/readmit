// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {HegotaSupport, Devnet, Scope, TxParam, FrameParam, FrameMode} from "@forshtat/hegota-support/contracts/HegotaSupport.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolId} from "v4-core/src/types/PoolId.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {FullMath} from "v4-core/src/libraries/FullMath.sol";
import {IERC20Minimal} from "v4-core/src/interfaces/external/IERC20Minimal.sol";

interface IStakingRegistry { function addStake(uint32 unstakeDelaySec) external payable; }

/// ERC20 gas paymaster for EIP-8141 frame txs, priced by a Uniswap v4 ETH/TOKEN pool (currency0 = native ETH).
/// VERIFY reads PoolManager storage (extsload) -> a non-entity storage read: canonical mempool rejects
/// (ethrex StorageReadNonSender), alt mempool admits once this paymaster is staked (STORAGE-032).
contract V4PricedPaymaster is HegotaSupport(Devnet.ERC8421_WORKSHOP) {
    using StateLibrary for IPoolManager;

    IPoolManager public immutable POOL_MANAGER;
    PoolId public immutable POOL_ID;
    address public immutable TOKEN;
    uint256 public constant MARKUP_BPS = 11_000; // +10%
    // ponytail: spot slot0 is manipulable within a block; bound it against a TWAP/oracle hook before real money.
    address public immutable OWNER;

    constructor(IPoolManager pm, PoolId id, address token) payable {
        POOL_MANAGER = pm; POOL_ID = id; TOKEN = token; OWNER = msg.sender;
    }

    /// Owner recovers the ETH deposit and the tUSD collected as gas fees.
    function withdraw(address payable to, uint256 eth, uint256 tusd) external {
        require(msg.sender == OWNER, "not owner");
        if (tusd > 0) require(IERC20Minimal(TOKEN).transfer(to, tusd), "token transfer failed");
        if (eth > 0) {
            (bool ok,) = to.call{value: eth}("");
            require(ok, "eth transfer failed");
        }
    }

    function stake(uint32 unstakeDelaySec, IStakingRegistry registry) external payable {
        registry.addStake{value: msg.value}(unstakeDelaySec); // registry keys stake off msg.sender = this contract
    }

    /// TOKEN owed for `weiCost` of gas: token1/token0 = sqrtP^2 / 2^192 (raw units).
    function quote(uint256 weiCost) public view returns (uint256) {
        (uint160 sqrtP,,,) = POOL_MANAGER.getSlot0(POOL_ID); // <- the Uniswap read the mempool rules care about
        uint256 owed = FullMath.mulDiv(FullMath.mulDiv(weiCost, sqrtP, 1 << 96), sqrtP, 1 << 96);
        return owed * MARKUP_BPS / 10_000;
    }

    /// The VERIFY frame targeting this paymaster lands here. Requires the NEXT frame to be a SENDER frame
    /// calling TOKEN.transfer(address(this), >= quote(maxCost)).
    fallback() external payable {
        uint256 next = txparam(TxParam.CURRENT_FRAME_INDEX) + 1;
        require(frameparam(next, FrameParam.MODE) == uint256(FrameMode.SENDER), "next frame not SENDER");
        require(address(uint160(frameparam(next, FrameParam.RESOLVED_TARGET))) == TOKEN, "next frame not TOKEN");
        bytes32 w0 = framedataload(0, next);
        require(bytes4(w0) == bytes4(0xa9059cbb), "not transfer()");          // transfer(address,uint256)
        require(address(uint160(uint256(framedataload(4, next)))) == address(this), "not to paymaster");
        uint256 paid = uint256(framedataload(36, next));
        require(paid >= quote(txparam(TxParam.MAX_COST)), "underpaid");
        // Without this, a sender with no TOKEN gets gas paid and the SENDER transfer frame just reverts.
        // balanceOf(sender) reads TOKEN slot keccak(sender . n): sender-associated, so allowed even unstaked.
        require(IERC20Minimal(TOKEN).balanceOf(address(uint160(txparam(TxParam.SENDER)))) >= paid, "sender lacks TOKEN");
        approve(Scope.PAYMENT);
    }
}
