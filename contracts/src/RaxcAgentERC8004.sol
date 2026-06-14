// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Official ERC-8004 registries on Mantle Testnet
interface IERC8004IdentityRegistry {
  function registerAgent(address agent, string calldata name, string calldata version, string calldata metadataURI) external returns (uint256 agentId);
  function getAgent(uint256 agentId) external view returns (address agent, string memory name, string memory version, string memory metadataURI, uint256 createdAt, bool active);
}

interface IERC8004ReputationRegistry {
  function logAchievement(uint256 agentId, string calldata category, uint256 score, string calldata proofURI) external returns (uint256 achievementId);
  function getAchievement(uint256 achievementId) external view returns (uint256 agentId, string memory category, uint256 score, string memory proofURI, uint256 timestamp);
  function getAgentScore(uint256 agentId, string calldata category) external view returns (uint256 totalScore, uint256 count);
}

/// @title RaxcAgentERC8004
/// @notice Audit records + long-context memory, integrated with official ERC-8004 registries.
///         On-chain proof of every RAXC audit, linked to agent identity and reputation.
contract RaxcAgentERC8004 {
  // ── Official ERC-8004 Registries (Mantle Testnet) ───────────────────────
  IERC8004IdentityRegistry public constant IDENTITY = IERC8004IdentityRegistry(0x8004A818BFB912233c491871b3d84c89A494BD9e);
  IERC8004ReputationRegistry public constant REPUTATION = IERC8004ReputationRegistry(0x8004B663056A597Dffe9eCcC1965A193B7388713);

  // ── Structs ─────────────────────────────────────────────────────────────

  struct AuditRecord {
    string contractName;
    uint8 riskLevel;
    uint64 confidence;
    string vulnType;
    bytes32 reportHash;
    uint256 createdAt;
    uint256 completedAt;
    bool finalized;
    bool encrypted;        // true = ECIES encrypted, owner-only
    bytes encryptedKey;    // ECIES-encrypted AES key (only set when encrypted=true)
  }

  struct MemoryEntry {
    bytes32 contentHash;
    string description;
    uint256 timestamp;
  }

  // ── Events ──────────────────────────────────────────────────────────────

  event AuditCreated(uint256 indexed erc8004Id, uint256 indexed recordId, string contractName, uint256 timestamp);
  event AuditFinalized(uint256 indexed erc8004Id, uint256 indexed recordId, uint8 riskLevel, uint64 confidence, bytes32 reportHash, uint256 achievementId, uint256 timestamp);
  event AuditFinalizedEncrypted(uint256 indexed erc8004Id, uint256 indexed recordId, uint8 riskLevel, uint64 confidence, bytes32 reportHash, uint256 achievementId, uint256 timestamp);
  event MemoryPushed(uint256 indexed erc8004Id, uint256 indexed entryIndex, bytes32 contentHash, uint256 timestamp);

  // ── Storage ─────────────────────────────────────────────────────────────

  // ERC-8004 agent ID (from IdentityRegistry)
  uint256 public agentId;

  // Audit records: recordId → AuditRecord
  uint256 public recordCount;
  mapping(uint256 => AuditRecord) public audits;
  mapping(uint256 => bytes) public reportData;
  mapping(uint256 => address) public auditOwner;      // recordId → msg.sender who created it
  mapping(address => uint256[]) private _ownerRecords; // owner → list of recordIds

  // Long-context memory: index → entry
  uint256 public memoryCount;
  mapping(uint256 => bytes) public memoryData;
  mapping(uint256 => MemoryEntry) public memories;

  // Simple stats
  uint256 public totalAudits;
  uint256 public totalMemories;

  // ── Initialization ──────────────────────────────────────────────────────

  /// Register this contract as an ERC-8004 agent with the official IdentityRegistry.
  /// Call once after deployment.
  function register(string calldata name, string calldata version, string calldata metadataURI) external returns (uint256) {
    require(agentId == 0, "already registered");
    agentId = IDENTITY.registerAgent(address(this), name, version, metadataURI);
    return agentId;
  }

  /// Read our agent info from the official registry
  function agentInfo() external view returns (address, string memory, string memory, string memory, uint256, bool) {
    return IDENTITY.getAgent(agentId);
  }

  // ── Audit Records ───────────────────────────────────────────────────────

  function createAudit(string calldata contractName) external returns (uint256 recordId) {
    require(agentId != 0, "register first");
    recordId = recordCount++;
    audits[recordId] = AuditRecord({
      contractName: contractName,
      riskLevel: 0,
      confidence: 0,
      vulnType: "",
      reportHash: bytes32(0),
      createdAt: block.timestamp,
      completedAt: 0,
      finalized: false,
      encrypted: false,
      encryptedKey: ""
    });
    auditOwner[recordId] = msg.sender;
    _ownerRecords[msg.sender].push(recordId);
    emit AuditCreated(agentId, recordId, contractName, block.timestamp);
  }

  /// Get all record IDs owned by an address
  function getRecordsByOwner(address _owner) external view returns (uint256[] memory) {
    return _ownerRecords[_owner];
  }

  /// Get count of records owned by an address
  function getRecordCountByOwner(address _owner) external view returns (uint256) {
    return _ownerRecords[_owner].length;
  }

  function finalizeAudit(
    uint256 recordId,
    uint8 riskLevel,
    uint64 confidence,
    string calldata vulnType,
    bytes calldata reportMarkdown
  ) external returns (uint256 achievementId) {
    require(agentId != 0, "register first");
    AuditRecord storage r = audits[recordId];
    require(r.createdAt != 0, "audit not found");
    require(!r.finalized, "already finalized");
    require(confidence <= 100, "confidence must be 0-100");

    bytes32 hash = keccak256(reportMarkdown);

    r.riskLevel = riskLevel;
    r.confidence = confidence;
    r.vulnType = vulnType;
    r.reportHash = hash;
    r.completedAt = block.timestamp;
    r.finalized = true;
    reportData[recordId] = reportMarkdown;
    totalAudits++;

    // Log to official ERC-8004 ReputationRegistry
    string memory category = _riskCategory(riskLevel);
    string memory proofURI = string(abi.encodePacked("raxc://audit/", _uint2str(recordId)));
    achievementId = REPUTATION.logAchievement(agentId, category, confidence, proofURI);

    emit AuditFinalized(agentId, recordId, riskLevel, confidence, hash, achievementId, block.timestamp);
  }

  /// Store an ECIES-encrypted report. Only the owner can later decrypt it
  /// with their private key via ECDH (client-side, e.g. ethers.js / MetaMask).
  /// @param encryptedReport Markdown encrypted with AES-256-GCM
  /// @param encryptedAesKey AES key encrypted with owner's public key (ECIES)
  function finalizeAuditEncrypted(
    uint256 recordId,
    uint8 riskLevel,
    uint64 confidence,
    string calldata vulnType,
    bytes calldata encryptedReport,
    bytes calldata encryptedAesKey
  ) external returns (uint256 achievementId) {
    require(agentId != 0, "register first");
    AuditRecord storage r = audits[recordId];
    require(r.createdAt != 0, "audit not found");
    require(!r.finalized, "already finalized");
    require(confidence <= 100, "confidence must be 0-100");

    bytes32 hash = keccak256(encryptedReport);

    r.riskLevel = riskLevel;
    r.confidence = confidence;
    r.vulnType = vulnType;
    r.reportHash = hash;
    r.completedAt = block.timestamp;
    r.finalized = true;
    r.encrypted = true;
    r.encryptedKey = encryptedAesKey;
    reportData[recordId] = encryptedReport;
    totalAudits++;

    string memory category = _riskCategory(riskLevel);
    string memory proofURI = string(abi.encodePacked("raxc://audit/encrypted/", _uint2str(recordId)));
    achievementId = REPUTATION.logAchievement(agentId, category, confidence, proofURI);

    emit AuditFinalizedEncrypted(agentId, recordId, riskLevel, confidence, hash, achievementId, block.timestamp);
  }

  /// Verify that a signature matches a given address.
  /// Used by frontend to prove ownership before decrypting.
  function verifyOwner(address claimed, bytes32 messageHash, bytes calldata signature) external pure returns (bool) {
    return _recoverSigner(messageHash, signature) == claimed;
  }

  /// Read the full markdown report for a record
  function getReport(uint256 recordId) external view returns (bytes memory) {
    require(audits[recordId].createdAt != 0, "audit not found");
    return reportData[recordId];
  }

  /// Check if a report is finalized
  function isFinalized(uint256 recordId) external view returns (bool) {
    return audits[recordId].finalized;
  }

  // ── Long-Context Memory ─────────────────────────────────────────────────

  /// Read a single memory entry by index
  function getMemoryData(uint256 index) external view returns (bytes memory) {
    require(index < memoryCount, "index out of bounds");
    return memoryData[index];
  }

  function pushMemory(bytes calldata summaryJson, string calldata description) external {
    require(agentId != 0, "register first");
    require(summaryJson.length > 0, "empty memory");

    uint256 index = memoryCount++;
    bytes32 hash = keccak256(summaryJson);

    memoryData[index] = summaryJson;
    memories[index] = MemoryEntry({ contentHash: hash, description: description, timestamp: block.timestamp });
    totalMemories++;

    emit MemoryPushed(agentId, index, hash, block.timestamp);
  }

  function verifyMemory(uint256 index, bytes calldata data) external view returns (bool) {
    if (index >= memoryCount) return false;
    return keccak256(data) == memories[index].contentHash;
  }

  // ── Reputation ──────────────────────────────────────────────────────────

  /// Get audit score from official ReputationRegistry
  function reputation(string calldata category) external view returns (uint256 totalScore, uint256 count) {
    return REPUTATION.getAgentScore(agentId, category);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  function _riskCategory(uint8 level) internal pure returns (string memory) {
    if (level == 4) return "audit_critical";
    if (level == 3) return "audit_high";
    if (level == 2) return "audit_medium";
    if (level == 1) return "audit_low";
    return "audit_none";
  }

  function _uint2str(uint256 value) internal pure returns (string memory) {
    if (value == 0) return "0";
    uint256 temp = value;
    uint256 digits;
    while (temp != 0) { digits++; temp /= 10; }
    bytes memory buffer = new bytes(digits);
    while (value != 0) { digits--; buffer[digits] = bytes1(uint8(48 + (value % 10))); value /= 10; }
    return string(buffer);
  }

  function _recoverSigner(bytes32 hash, bytes memory sig) internal pure returns (address) {
    require(sig.length == 65, "invalid signature length");
    bytes32 r; bytes32 s; uint8 v;
    assembly {
      r := mload(add(sig, 32))
      s := mload(add(sig, 64))
      v := byte(0, mload(add(sig, 96)))
    }
    if (v < 27) v += 27;
    require(v == 27 || v == 28, "invalid v");
    return ecrecover(hash, v, r, s);
  }
}

