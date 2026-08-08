// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title RWAAssetRegistry
 * @notice On-chain registry tracking Real-World Asset (RWA) state, NAV, custody, settlement, and risk posture.
 */
contract RWAAssetRegistry is Ownable {
    struct AssetState {
        string assetId;
        string assetType;
        uint256 nav; // 6 decimals USD
        uint256 yieldRate; // Basis points (e.g. 520 = 5.20%)
        bytes32 custodyStatus; // e.g. keccak256("VERIFIED")
        bytes32 settlementStatus; // e.g. keccak256("SETTLED")
        bytes32 riskStatus; // e.g. keccak256("PASS") / keccak256("LOW")
        uint256 lastUpdatedAt;
        bool exists;
    }

    mapping(string => AssetState) private _assets;
    address public oracleAdapter;

    event AssetUpdated(
        string indexed assetId,
        uint256 nav,
        uint256 yieldRate,
        bytes32 custodyStatus,
        bytes32 settlementStatus,
        bytes32 riskStatus,
        uint256 timestamp
    );

    error UnauthorizedCaller();
    error AssetNotFound();

    modifier onlyOracleOrOwner() {
        if (msg.sender != owner() && msg.sender != oracleAdapter) {
            revert UnauthorizedCaller();
        }
        _;
    }

    constructor() Ownable(msg.sender) {}

    function setOracleAdapter(address _oracleAdapter) external onlyOwner {
        oracleAdapter = _oracleAdapter;
    }

    function updateAsset(
        string calldata assetId,
        string calldata assetType,
        uint256 nav,
        uint256 yieldRate,
        bytes32 custodyStatus,
        bytes32 settlementStatus,
        bytes32 riskStatus
    ) external onlyOracleOrOwner {
        _assets[assetId] = AssetState({
            assetId: assetId,
            assetType: assetType,
            nav: nav,
            yieldRate: yieldRate,
            custodyStatus: custodyStatus,
            settlementStatus: settlementStatus,
            riskStatus: riskStatus,
            lastUpdatedAt: block.timestamp,
            exists: true
        });

        emit AssetUpdated(
            assetId,
            nav,
            yieldRate,
            custodyStatus,
            settlementStatus,
            riskStatus,
            block.timestamp
        );
    }

    function getAsset(string calldata assetId) external view returns (AssetState memory) {
        if (!_assets[assetId].exists) revert AssetNotFound();
        return _assets[assetId];
    }
}
