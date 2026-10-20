// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Minimal {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @notice Prototype facility showing the core shared-credit invariants.
/// @dev Not audited. Use Arc Studio to create and test the Arc submission contracts.
contract WorkingCapitalFacility {
    error Unauthorized();
    error InvalidAmount();
    error CreditLimitExceeded();
    error DuplicateReceivable();
    error InvalidReceivable();
    error TransferFailed();

    enum Status { None, Active, Repaid }

    struct Facility {
        address operator;
        uint128 borrowingBase;
        uint128 principal;
        uint128 outstanding;
        uint128 totalReserved;
        uint128 totalSpent;
        Status status;
    }

    struct Reservation {
        address agent;
        uint128 amount;
        bool finalized;
    }

    IERC20Minimal public immutable usdc;
    address public owner;
    mapping(bytes32 => Facility) public facilities;
    mapping(bytes32 => bool) public usedReceivables;
    mapping(bytes32 => mapping(address => uint128)) public budget;
    mapping(bytes32 => mapping(address => uint128)) public spent;
    mapping(bytes32 => mapping(address => uint128)) public reservedByAgent;
    mapping(bytes32 => uint128) public totalAssigned;
    mapping(bytes32 => mapping(bytes32 => Reservation)) public reservations;
    mapping(bytes32 => mapping(bytes32 => bool)) public usedAttestations;

    event FacilityOpened(bytes32 indexed facilityId, bytes32 indexed receivableId, uint256 borrowingBase, uint256 funded);
    event BudgetAssigned(bytes32 indexed facilityId, address indexed agent, uint256 amount);
    event SpendReserved(bytes32 indexed facilityId, address indexed agent, bytes32 indexed intentId, uint256 amount);
    event SpendCommitted(bytes32 indexed facilityId, address indexed agent, bytes32 indexed intentId, uint256 amount);
    event SpendReleased(bytes32 indexed facilityId, address indexed agent, bytes32 indexed intentId, uint256 amount);
    event Repaid(bytes32 indexed facilityId, uint256 lendersPaid, uint256 operatorPaid);

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    constructor(address usdcAddress) {
        if (usdcAddress == address(0)) revert InvalidAmount();
        owner = msg.sender;
        usdc = IERC20Minimal(usdcAddress);
    }

    function openFacility(
        bytes32 facilityId,
        bytes32 receivableId,
        address operator,
        uint128 faceValue,
        uint16 advanceRateBps,
        uint128 funded
    ) external onlyOwner {
        if (receivableId == bytes32(0) || operator == address(0) || faceValue == 0 || advanceRateBps > 10_000) revert InvalidAmount();
        if (usedReceivables[receivableId]) revert DuplicateReceivable();
        uint128 base = uint128(uint256(faceValue) * advanceRateBps / 10_000);
        if (funded == 0 || funded > base) revert CreditLimitExceeded();
        if (facilities[facilityId].status != Status.None) revert InvalidReceivable();

        usedReceivables[receivableId] = true;
        facilities[facilityId] = Facility(operator, base, funded, funded, 0, 0, Status.Active);
        if (!usdc.transferFrom(msg.sender, address(this), funded)) revert TransferFailed();
        emit FacilityOpened(facilityId, receivableId, base, funded);
    }

    function assignBudget(bytes32 facilityId, address agent, uint128 amount) external {
        Facility storage f = facilities[facilityId];
        if (msg.sender != f.operator) revert Unauthorized();
        if (f.status != Status.Active || agent == address(0) || amount == 0) revert InvalidAmount();
        uint256 available = uint256(f.principal) - totalAssigned[facilityId] + budget[facilityId][agent];
        if (amount > available) revert CreditLimitExceeded();
        totalAssigned[facilityId] = uint128(uint256(totalAssigned[facilityId]) + amount - budget[facilityId][agent]);
        budget[facilityId][agent] = amount;
        emit BudgetAssigned(facilityId, agent, amount);
    }

    function reserveSpend(bytes32 facilityId, bytes32 intentId, uint128 amount) external {
        Facility storage f = facilities[facilityId];
        if (f.status != Status.Active || amount == 0 || intentId == bytes32(0)) revert InvalidAmount();
        if (spent[facilityId][msg.sender] + reservedByAgent[facilityId][msg.sender] + amount > budget[facilityId][msg.sender]) revert CreditLimitExceeded();
        if (uint256(f.totalSpent) + f.totalReserved + amount > f.principal) revert CreditLimitExceeded();
        if (reservations[facilityId][intentId].agent != address(0)) revert InvalidReceivable();
        f.totalReserved += amount;
        reservedByAgent[facilityId][msg.sender] += amount;
        reservations[facilityId][intentId] = Reservation(msg.sender, amount, false);
        emit SpendReserved(facilityId, msg.sender, intentId, amount);
    }

    function commitSpend(bytes32 facilityId, bytes32 intentId, uint128 amount) external {
        Facility storage f = facilities[facilityId];
        Reservation storage r = reservations[facilityId][intentId];
        if (msg.sender != owner) revert Unauthorized();
        if (amount == 0 || r.agent == address(0) || r.finalized || amount != r.amount) revert InvalidAmount();
        f.totalReserved -= amount;
        f.totalSpent += amount;
        reservedByAgent[facilityId][r.agent] -= amount;
        spent[facilityId][r.agent] += amount;
        r.finalized = true;
        emit SpendCommitted(facilityId, r.agent, intentId, amount);
    }

    function releaseSpend(bytes32 facilityId, bytes32 intentId, uint128 amount) external {
        Facility storage f = facilities[facilityId];
        Reservation storage r = reservations[facilityId][intentId];
        if (msg.sender != owner) revert Unauthorized();
        if (amount == 0 || r.agent == address(0) || r.finalized || amount != r.amount) revert InvalidAmount();
        f.totalReserved -= amount;
        reservedByAgent[facilityId][r.agent] -= amount;
        r.finalized = true;
        emit SpendReleased(facilityId, r.agent, intentId, amount);
    }

    function recordAttestation(bytes32 facilityId, bytes32 sourceTransactionHash, uint64 expiry) external onlyOwner {
        if (expiry < block.timestamp || sourceTransactionHash == bytes32(0)) revert InvalidAmount();
        if (usedAttestations[facilityId][sourceTransactionHash]) revert InvalidReceivable();
        usedAttestations[facilityId][sourceTransactionHash] = true;
    }

    function repay(bytes32 facilityId, uint128 lendersDue, uint128 customerPayment) external onlyOwner {
        Facility storage f = facilities[facilityId];
        if (f.status != Status.Active || customerPayment < lendersDue || lendersDue < f.outstanding) revert InvalidAmount();
        f.status = Status.Repaid;
        f.outstanding = 0;
        uint128 operatorAmount = customerPayment - lendersDue;
        if (!usdc.transfer(owner, lendersDue)) revert TransferFailed();
        if (operatorAmount > 0 && !usdc.transfer(f.operator, operatorAmount)) revert TransferFailed();
        emit Repaid(facilityId, lendersDue, operatorAmount);
    }
}
