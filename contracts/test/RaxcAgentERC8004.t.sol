// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/RaxcAgentERC8004.sol";

/// Minimal mock that returns a fixed agentId without needing Mantle testnet
contract MockIdentityRegistry {
  function registerAgent(address, string calldata, string calldata, string calldata) external pure returns (uint256) {
    return 42;
  }
}

contract MockReputationRegistry {
  function logAchievement(uint256, string calldata, uint256, string calldata) external pure returns (uint256) {
    return 1;
  }
}

contract RaxcAgentERC8004Test is Test {
  RaxcAgentERC8004 public raxc;
  address owner   = address(0x1234);
  address owner2  = address(0x5678);
  string  markdown = "# Report\n**Vuln:** Reentrancy\n**Risk:** High";

  function setUp() public {
    // Deploy mock registries at official Mantle testnet addresses
    vm.etch(address(0x8004A818BFB912233c491871b3d84c89A494BD9e), address(new MockIdentityRegistry()).code);
    vm.etch(address(0x8004B663056A597Dffe9eCcC1965A193B7388713), address(new MockReputationRegistry()).code);

    vm.prank(owner);
    raxc = new RaxcAgentERC8004();
    vm.prank(owner);
    raxc.register("RAXCLAW", "v0.9.1", "ipfs://meta");
  }

  // ── Registration ────────────────────────────────────────────────────

  function testRegistration() public view {
    assertEq(raxc.agentId(), 42);
  }

  // ── Full Audit Workflow ─────────────────────────────────────────────

  function testFullAuditFlow() public {
    vm.prank(owner);
    uint256 rid = raxc.createAudit("DeFiVault");
    assertEq(rid, 0);
    assertEq(raxc.recordCount(), 1);

    vm.prank(owner);
    uint256 aid = raxc.finalizeAudit(rid, 3, 82, "Reentrancy", bytes(markdown));
    assertEq(aid, 1);

    // Read back
    bytes memory report = raxc.getReport(rid);
    assertEq(string(report), markdown);

    // Metadata
    (string memory name, uint8 risk, uint64 conf, string memory vuln,,,,,,) = raxc.audits(rid);
    assertEq(name, "DeFiVault");
    assertEq(risk, 3);
    assertEq(conf, 82);
    assertEq(vuln, "Reentrancy");
    assertTrue(raxc.isFinalized(rid));
    assertEq(raxc.totalAudits(), 1);
  }

  function testAuditOwnerTracking() public {
    vm.prank(owner);
    raxc.createAudit("VaultA");  // rid=0
    vm.prank(owner);
    raxc.createAudit("VaultB");  // rid=1
    vm.prank(owner2);
    raxc.createAudit("VaultC");  // rid=2

    assertEq(raxc.auditOwner(0), owner);
    assertEq(raxc.auditOwner(2), owner2);

    uint256[] memory ownerIDs = raxc.getRecordsByOwner(owner);
    assertEq(ownerIDs.length, 2);
    assertEq(ownerIDs[0], 0);
    assertEq(ownerIDs[1], 1);
  }

  // ── Encrypted Audit ─────────────────────────────────────────────────

  function testEncryptedAudit() public {
    vm.prank(owner);
    uint256 rid = raxc.createAudit("SecretVault");

    bytes memory ciphertext = hex"deadbeef";
    bytes memory encKey     = hex"cafebabe";

    vm.prank(owner);
    raxc.finalizeAuditEncrypted(rid, 4, 95, "Critical", ciphertext, encKey);

    bytes memory stored = raxc.getReport(rid);
    assertEq(stored, ciphertext);  // stored as encrypted

    (,,,,,,,, bool enc,) = raxc.audits(rid);
    assertTrue(enc);  // encrypted flag set
  }

  // ── Long-Context Memory ─────────────────────────────────────────────

  function testPushAndReadMemory() public {
    vm.prank(owner);
    raxc.pushMemory(bytes('{"vuln":"Reentrancy","risk":"High"}'), "DeFiVault audit");

    assertEq(raxc.memoryCount(), 1);
    assertEq(raxc.totalMemories(), 1);

    bytes memory data = raxc.getMemoryData(0);
    assertEq(string(data), '{"vuln":"Reentrancy","risk":"High"}');

    assertTrue(raxc.verifyMemory(0, bytes('{"vuln":"Reentrancy","risk":"High"}')));
    assertFalse(raxc.verifyMemory(0, bytes("wrong data")));
  }

  function testGetMemoryData_OutOfBounds() public {
    vm.expectRevert("index out of bounds");
    raxc.getMemoryData(0);
  }

  // ── Guard Tests ─────────────────────────────────────────────────────

  function testCannotDoubleRegister() public {
    vm.prank(owner);
    vm.expectRevert("already registered");
    raxc.register("RAXCLAW", "v2", "ipfs://v2");
  }

  // ── Edge Cases ──────────────────────────────────────────────────────

  function testFinalizeNonExistentAudit() public {
    vm.prank(owner);
    vm.expectRevert("audit not found");
    raxc.finalizeAudit(999, 1, 50, "Test", bytes("test"));
  }

  function testDoubleFinalize() public {
    vm.prank(owner);
    uint256 rid = raxc.createAudit("Test");
    vm.prank(owner);
    raxc.finalizeAudit(rid, 1, 50, "Test", bytes("test"));
    vm.prank(owner);
    vm.expectRevert("already finalized");
    raxc.finalizeAudit(rid, 1, 50, "Test", bytes("test2"));
  }

  function testConfidenceBounds() public {
    vm.prank(owner);
    uint256 rid = raxc.createAudit("Test");
    vm.prank(owner);
    vm.expectRevert("confidence must be 0-100");
    raxc.finalizeAudit(rid, 1, 101, "Test", bytes("test"));
  }
}

