// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ClaimRegistry
 * @notice Registry tracking asynchronous claim tokens for vault requests before settlement.
 */
contract ClaimRegistry is Ownable {
    enum ClaimStatus { Active, Listed, Settled }

    struct Claim {
        uint256 claimId;
        string requestId;
        string assetId;
        address owner;
        uint256 faceValue;
        ClaimStatus status;
        uint256 createdAt;
    }

    uint256 public claimSequence;
    address public vault;
    address public claimMarket;

    mapping(uint256 => Claim) private _claims;

    event ClaimCreated(uint256 indexed claimId, string indexed requestId, address indexed owner, uint256 faceValue);
    event ClaimTransferred(uint256 indexed claimId, address indexed previousOwner, address indexed newOwner);
    event ClaimStatusUpdated(uint256 indexed claimId, ClaimStatus status);
    event ClaimSettled(uint256 indexed claimId, address indexed owner);

    error UnauthorizedCaller();
    error ClaimNotFound();
    error InvalidClaim();
    error NotClaimOwner();
    error ClaimNotTransferable();

    modifier onlyAuthorized() {
        if (msg.sender != owner() && msg.sender != vault && msg.sender != claimMarket) {
            revert UnauthorizedCaller();
        }
        _;
    }

    constructor() Ownable(msg.sender) {}

    function setVault(address _vault) external onlyOwner {
        vault = _vault;
    }

    function setClaimMarket(address _claimMarket) external onlyOwner {
        claimMarket = _claimMarket;
    }

    function createClaim(
        string calldata requestId,
        string calldata assetId,
        address claimOwner,
        uint256 faceValue
    ) external onlyAuthorized returns (uint256 claimId) {
        claimSequence++;
        claimId = claimSequence;

        _claims[claimId] = Claim({
            claimId: claimId,
            requestId: requestId,
            assetId: assetId,
            owner: claimOwner,
            faceValue: faceValue,
            status: ClaimStatus.Active,
            createdAt: block.timestamp
        });

        emit ClaimCreated(claimId, requestId, claimOwner, faceValue);
    }

    function transferClaim(uint256 claimId, address newOwner) external onlyAuthorized {
        Claim storage claim = _claims[claimId];
        if (claim.claimId == 0) revert ClaimNotFound();

        address oldOwner = claim.owner;
        claim.owner = newOwner;

        emit ClaimTransferred(claimId, oldOwner, newOwner);
    }

    function markClaimSettled(uint256 claimId) external onlyAuthorized {
        Claim storage claim = _claims[claimId];
        if (claim.claimId == 0) revert ClaimNotFound();

        claim.status = ClaimStatus.Settled;
        emit ClaimStatusUpdated(claimId, ClaimStatus.Settled);
        emit ClaimSettled(claimId, claim.owner);
    }

    function updateClaimStatus(uint256 claimId, ClaimStatus status) external onlyAuthorized {
        Claim storage claim = _claims[claimId];
        if (claim.claimId == 0) revert ClaimNotFound();

        claim.status = status;
        emit ClaimStatusUpdated(claimId, status);
    }

    function getClaim(uint256 claimId) external view returns (Claim memory) {
        if (_claims[claimId].claimId == 0) revert ClaimNotFound();
        return _claims[claimId];
    }

    function getClaimOwner(uint256 claimId) external view returns (address) {
        if (_claims[claimId].claimId == 0) revert ClaimNotFound();
        return _claims[claimId].owner;
    }
}
