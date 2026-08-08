// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./ClaimRegistry.sol";

/**
 * @title ClaimMarket
 * @notice Fixed-price peer-to-peer claim marketplace providing T+0 early liquidity for depositors.
 */
contract ClaimMarket is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable paymentAsset;
    ClaimRegistry public immutable claimRegistry;

    struct Listing {
        uint256 claimId;
        address seller;
        uint256 price; // Selling price in paymentAsset (6 decimals)
        bool active;
    }

    mapping(uint256 => Listing) private _listings;

    event ClaimListed(uint256 indexed claimId, address indexed seller, uint256 price);
    event ClaimListingCancelled(uint256 indexed claimId, address indexed seller);
    event ClaimPurchased(uint256 indexed claimId, address indexed seller, address indexed buyer, uint256 price);

    error NotClaimOwner();
    error ListingNotActive();
    error CannotBuySelf();
    error InvalidPrice();
    error ClaimAlreadySettled();

    constructor(address _paymentAsset, address _claimRegistry) Ownable(msg.sender) {
        paymentAsset = IERC20(_paymentAsset);
        claimRegistry = ClaimRegistry(_claimRegistry);
    }

    function listClaim(uint256 claimId, uint256 price) external nonReentrant {
        if (price == 0) revert InvalidPrice();

        ClaimRegistry.Claim memory claim = claimRegistry.getClaim(claimId);
        if (claim.owner != msg.sender) revert NotClaimOwner();
        if (claim.status == ClaimRegistry.ClaimStatus.Settled) revert ClaimAlreadySettled();

        _listings[claimId] = Listing({
            claimId: claimId,
            seller: msg.sender,
            price: price,
            active: true
        });

        claimRegistry.updateClaimStatus(claimId, ClaimRegistry.ClaimStatus.Listed);

        emit ClaimListed(claimId, msg.sender, price);
    }

    function cancelListing(uint256 claimId) external nonReentrant {
        Listing storage listing = _listings[claimId];
        if (!listing.active) revert ListingNotActive();
        if (listing.seller != msg.sender) revert NotClaimOwner();

        listing.active = false;
        claimRegistry.updateClaimStatus(claimId, ClaimRegistry.ClaimStatus.Active);

        emit ClaimListingCancelled(claimId, msg.sender);
    }

    function buyClaim(uint256 claimId) external nonReentrant {
        Listing storage listing = _listings[claimId];
        if (!listing.active) revert ListingNotActive();
        if (listing.seller == msg.sender) revert CannotBuySelf();

        address seller = listing.seller;
        uint256 price = listing.price;

        listing.active = false;

        paymentAsset.safeTransferFrom(msg.sender, seller, price);
        claimRegistry.transferClaim(claimId, msg.sender);
        claimRegistry.updateClaimStatus(claimId, ClaimRegistry.ClaimStatus.Active);

        emit ClaimPurchased(claimId, seller, msg.sender, price);
    }

    function getListing(uint256 claimId) external view returns (Listing memory) {
        return _listings[claimId];
    }
}
