// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockUSDC
 * @notice Mock ERC-20 token representing USDC collateral for RWA settlement testing.
 */
contract MockUSDC is ERC20, Ownable {
    uint8 private constant _DECIMALS = 6;

    constructor() ERC20("Mock USD Coin", "mUSDC") Ownable(msg.sender) {
        _mint(msg.sender, 1_000_000_000 * 10**_DECIMALS);
    }

    function decimals() public pure override returns (uint8) {
        return _DECIMALS;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function faucet(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
