// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IClaimRegistry {
    function createClaim(
        string calldata requestId,
        string calldata assetId,
        address owner,
        uint256 faceValue
    ) external returns (uint256 claimId);

    function markClaimSettled(uint256 claimId) external;
    function getClaimOwner(uint256 claimId) external view returns (address);
}

/**
 * @title AsyncRWAVault
 * @notice ERC-7540 Asynchronous Vault for tokenized Real-World Assets.
 * Enforces strict separation between pending requests and claimable balances.
 */
contract AsyncRWAVault is ERC20, Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable asset;
    address public oracleAdapter;
    IClaimRegistry public claimRegistry;

    uint256 public requestSequence;

    enum RequestKind { Deposit, Redeem }
    enum RequestState { Requested, Pending, Verified, Settled, Claimable, Finalized, Rejected }

    struct RequestInfo {
        string requestId;
        RequestKind kind;
        address owner;
        uint256 amount; // Asset amount for deposit, Share amount for redeem
        uint256 claimableShares; // Final shares awarded upon settlement
        uint256 claimableAssets; // Final assets awarded upon settlement
        RequestState state;
        uint256 createdAt;
        uint256 claimId;
    }

    mapping(string => RequestInfo) private _requests;
    mapping(uint256 => string) public claimIdToRequestId;

    event DepositRequested(string indexed requestId, address indexed owner, uint256 assets);
    event DepositClaimable(string indexed requestId, address indexed owner, uint256 shares);
    event DepositClaimed(string indexed requestId, address indexed owner, uint256 shares);

    event RedeemRequested(string indexed requestId, address indexed owner, uint256 shares);
    event RedeemClaimable(string indexed requestId, address indexed owner, uint256 assets);
    event RedeemClaimed(string indexed requestId, address indexed owner, uint256 assets);

    event RequestRejected(string indexed requestId, string reason);
    event EmergencyPaused(address indexed operator);

    error UnauthorizedOracle();
    error InvalidAmount();
    error RequestNotFound();
    error RequestNotClaimable();
    error PrematureMintingViolation();
    error AlreadyClaimed();
    error TransferFailed();
    error InvalidStateTransition();

    modifier onlyOracle() {
        if (msg.sender != oracleAdapter) revert UnauthorizedOracle();
        _;
    }

    constructor(
        address _underlyingAsset,
        address _claimRegistry
    ) ERC20("RWA Treasury Vault Share", "vRWA") Ownable(msg.sender) {
        asset = IERC20(_underlyingAsset);
        claimRegistry = IClaimRegistry(_claimRegistry);
    }

    function isValidStateTransition(RequestState from, RequestState to) public pure returns (bool) {
        if (from == RequestState.Requested && to == RequestState.Pending) return true;
        if (from == RequestState.Pending && to == RequestState.Verified) return true;
        if (from == RequestState.Pending && to == RequestState.Claimable) return true;
        if (from == RequestState.Verified && to == RequestState.Settled) return true;
        if (from == RequestState.Settled && to == RequestState.Claimable) return true;
        if (from == RequestState.Claimable && to == RequestState.Finalized) return true;

        if (
            (from == RequestState.Requested ||
                from == RequestState.Pending ||
                from == RequestState.Verified ||
                from == RequestState.Settled) &&
            to == RequestState.Rejected
        ) return true;

        return false;
    }

    function _transitionState(RequestInfo storage req, RequestState nextState) internal {
        if (!isValidStateTransition(req.state, nextState)) {
            revert InvalidStateTransition();
        }
        req.state = nextState;
    }

    function setOracleAdapter(address _oracleAdapter) external onlyOwner {
        oracleAdapter = _oracleAdapter;
    }

    function setClaimRegistry(address _claimRegistry) external onlyOwner {
        claimRegistry = IClaimRegistry(_claimRegistry);
    }

    function pause() external onlyOwner {
        _pause();
        emit EmergencyPaused(msg.sender);
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Submit an asynchronous deposit request. Assets are transferred to vault immediately,
     * but NO SHARES are minted until settlement attestation passes.
     */
    function requestDeposit(uint256 assetsAmount) external whenNotPaused nonReentrant returns (string memory requestId) {
        if (assetsAmount == 0) revert InvalidAmount();

        asset.safeTransferFrom(msg.sender, address(this), assetsAmount);

        requestSequence++;
        requestId = string(abi.encodePacked("REQ-", _toString(requestSequence)));

        uint256 claimId = 0;
        if (address(claimRegistry) != address(0)) {
            claimId = claimRegistry.createClaim(requestId, "RWA-001", msg.sender, assetsAmount);
            claimIdToRequestId[claimId] = requestId;
        }

        _requests[requestId] = RequestInfo({
            requestId: requestId,
            kind: RequestKind.Deposit,
            owner: msg.sender,
            amount: assetsAmount,
            claimableShares: 0,
            claimableAssets: 0,
            state: RequestState.Pending,
            createdAt: block.timestamp,
            claimId: claimId
        });

        emit DepositRequested(requestId, msg.sender, assetsAmount);
    }

    /**
     * @notice Submit an asynchronous redemption request. Vault shares are locked,
     * but NO ASSETS are claimable until settlement attestation passes.
     */
    function requestRedeem(uint256 sharesAmount) external whenNotPaused nonReentrant returns (string memory requestId) {
        if (sharesAmount == 0) revert InvalidAmount();

        _transfer(msg.sender, address(this), sharesAmount);

        requestSequence++;
        requestId = string(abi.encodePacked("REQ-", _toString(requestSequence)));

        _requests[requestId] = RequestInfo({
            requestId: requestId,
            kind: RequestKind.Redeem,
            owner: msg.sender,
            amount: sharesAmount,
            claimableShares: 0,
            claimableAssets: 0,
            state: RequestState.Pending,
            createdAt: block.timestamp,
            claimId: 0
        });

        emit RedeemRequested(requestId, msg.sender, sharesAmount);
    }

    /**
     * @notice Callback from RWAOracleAdapter when real-world state attestation succeeds.
     */
    function onAttestationSettled(string calldata requestId, uint256 /* nav */) external onlyOracle {
        RequestInfo storage req = _requests[requestId];
        if (req.state != RequestState.Pending && req.state != RequestState.Requested) return;

        _transitionState(req, RequestState.Claimable);

        if (req.kind == RequestKind.Deposit) {
            // Calculate 1:1 shares based on NAV or 1 USD = 1 share for simplicity (6 decimals)
            req.claimableShares = (req.amount * 10**decimals()) / 10**6;
            emit DepositClaimable(requestId, req.owner, req.claimableShares);
        } else {
            req.claimableAssets = (req.amount * 10**6) / 10**decimals();
            emit RedeemClaimable(requestId, req.owner, req.claimableAssets);
        }
    }

    function onAttestationRejected(string calldata requestId, string calldata reason) external onlyOracle {
        RequestInfo storage req = _requests[requestId];
        if (req.state == RequestState.Finalized || req.state == RequestState.Rejected) return;

        _transitionState(req, RequestState.Rejected);
        emit RequestRejected(requestId, reason);
    }

    /**
     * @notice Claim shares for a settled deposit request. Respects P2P claim market ownership transfer.
     */
    function claimShares(string calldata requestId) external whenNotPaused nonReentrant {
        RequestInfo storage req = _requests[requestId];
        if (req.state != RequestState.Claimable) revert RequestNotClaimable();
        if (req.kind != RequestKind.Deposit) revert RequestNotClaimable();

        // Premature minting protection check
        if (req.claimableShares == 0) revert PrematureMintingViolation();

        address recipient = req.owner;
        if (req.claimId > 0 && address(claimRegistry) != address(0)) {
            recipient = claimRegistry.getClaimOwner(req.claimId);
            claimRegistry.markClaimSettled(req.claimId);
        }

        _transitionState(req, RequestState.Finalized);
        uint256 sharesToMint = req.claimableShares;
        req.claimableShares = 0;

        _mint(recipient, sharesToMint);

        emit DepositClaimed(requestId, recipient, sharesToMint);
    }

    /**
     * @notice Claim underlying assets for a settled redemption request.
     */
    function claimAssets(string calldata requestId) external whenNotPaused nonReentrant {
        RequestInfo storage req = _requests[requestId];
        if (req.state != RequestState.Claimable) revert RequestNotClaimable();
        if (req.kind != RequestKind.Redeem) revert RequestNotClaimable();

        _transitionState(req, RequestState.Finalized);
        uint256 assetsToPayout = req.claimableAssets;
        req.claimableAssets = 0;

        _burn(address(this), req.amount);
        asset.safeTransfer(req.owner, assetsToPayout);

        emit RedeemClaimed(requestId, req.owner, assetsToPayout);
    }

    function getRequest(string calldata requestId) external view returns (RequestInfo memory) {
        return _requests[requestId];
    }

    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0000";
        bytes memory buffer = new bytes(4);
        for (uint256 i = 4; i > 0; i--) {
            buffer[i - 1] = bytes1(uint8(48 + (value % 10)));
            value /= 10;
        }
        return string(buffer);
    }
}
