// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "./RWAAssetRegistry.sol";

interface IAsyncVaultCallback {
    function onAttestationSettled(string calldata requestId, uint256 nav) external;
    function onAttestationRejected(string calldata requestId, string calldata reason) external;
}

/**
 * @title RWAOracleAdapter
 * @notice Oracle Adapter contract enforcing EIP-712 signed attestations, freshness checks, and replay prevention.
 */
contract RWAOracleAdapter is EIP712, Ownable {
    using ECDSA for bytes32;

    bytes32 public constant ATTESTATION_TYPEHASH = keccak256(
        "Attestation(string assetId,string requestId,string state,uint256 nav,uint256 yieldRate,bytes32 riskStatus,uint256 nonce,uint256 timestamp)"
    );

    struct AttestationParams {
        string assetId;
        string requestId;
        string state;
        uint256 nav;
        uint256 yieldRate;
        bytes32 riskStatus;
        uint256 nonce;
        uint256 timestamp;
    }

    address public attesterSigner;
    address public vault;
    RWAAssetRegistry public assetRegistry;
    uint256 public maxDataAge = 15 minutes;

    mapping(uint256 => bool) public usedNonces;

    event AttestationAccepted(
        string indexed requestId,
        string indexed assetId,
        string state,
        uint256 nav,
        uint256 yieldRate,
        uint256 timestamp
    );
    event AttestationRejected(
        string indexed requestId,
        string indexed assetId,
        string reason
    );
    event SignerUpdated(address indexed newSigner);
    event MaxDataAgeUpdated(uint256 newMaxAge);

    error InvalidAttestation();
    error UnauthorizedSigner();
    error ReplayedNonce();
    error StaleAttestation();
    error VaultNotConfigured();

    constructor(
        address _attesterSigner,
        address _assetRegistry
    ) EIP712("RWA-OracleAdapter", "1.0.0") Ownable(msg.sender) {
        attesterSigner = _attesterSigner;
        assetRegistry = RWAAssetRegistry(_assetRegistry);
    }

    function setAttesterSigner(address _signer) external onlyOwner {
        attesterSigner = _signer;
        emit SignerUpdated(_signer);
    }

    function setVault(address _vault) external onlyOwner {
        vault = _vault;
    }

    function setMaxDataAge(uint256 _maxAge) external onlyOwner {
        maxDataAge = _maxAge;
        emit MaxDataAgeUpdated(_maxAge);
    }

    function submitAttestation(
        AttestationParams calldata params,
        bytes calldata signature
    ) external returns (bool) {
        if (usedNonces[params.nonce]) {
            emit AttestationRejected(params.requestId, params.assetId, "REPLAYED_NONCE");
            revert ReplayedNonce();
        }

        if (block.timestamp > params.timestamp + maxDataAge) {
            emit AttestationRejected(params.requestId, params.assetId, "STALE_TIMESTAMP");
            if (vault != address(0)) {
                IAsyncVaultCallback(vault).onAttestationRejected(params.requestId, "STALE_TIMESTAMP");
            }
            revert StaleAttestation();
        }

        bytes32 structHash = keccak256(
            abi.encode(
                ATTESTATION_TYPEHASH,
                keccak256(bytes(params.assetId)),
                keccak256(bytes(params.requestId)),
                keccak256(bytes(params.state)),
                params.nav,
                params.yieldRate,
                params.riskStatus,
                params.nonce,
                params.timestamp
            )
        );

        bytes32 hash = _hashTypedDataV4(structHash);
        address recoveredSigner = ECDSA.recover(hash, signature);

        if (recoveredSigner != attesterSigner) {
            emit AttestationRejected(params.requestId, params.assetId, "INVALID_SIGNER");
            if (vault != address(0)) {
                IAsyncVaultCallback(vault).onAttestationRejected(params.requestId, "INVALID_SIGNER");
            }
            revert UnauthorizedSigner();
        }

        usedNonces[params.nonce] = true;

        assetRegistry.updateAsset(
            params.assetId,
            "TREASURY",
            params.nav,
            params.yieldRate,
            keccak256("VERIFIED"),
            keccak256(bytes(params.state)),
            params.riskStatus
        );

        emit AttestationAccepted(params.requestId, params.assetId, params.state, params.nav, params.yieldRate, params.timestamp);

        if (vault != address(0)) {
            if (keccak256(bytes(params.state)) == keccak256("SETTLED") || keccak256(bytes(params.state)) == keccak256("CLAIMABLE")) {
                IAsyncVaultCallback(vault).onAttestationSettled(params.requestId, params.nav);
            } else {
                IAsyncVaultCallback(vault).onAttestationRejected(params.requestId, "STATE_NOT_SETTLED");
            }
        }

        return true;
    }
}
