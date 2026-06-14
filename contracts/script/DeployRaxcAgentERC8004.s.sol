// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/RaxcAgentERC8004.sol";

/// @notice Deploy RaxcAgentERC8004 to Mantle Testnet
/// @dev Run: forge script script/DeployRaxcAgentERC8004.s.sol --rpc-url $MANTLE_RPC --broadcast -vvvv
contract DeployRaxcAgentERC8004 is Script {
  function run() external {
    uint256 deployerKey = vm.envUint("PRIVATE_KEY");
    string memory name    = vm.envOr("AGENT_NAME",    string("RAXCLAW"));
    string memory version = vm.envOr("AGENT_VERSION", string("v0.9.1"));

    vm.startBroadcast(deployerKey);

    RaxcAgentERC8004 raxc = new RaxcAgentERC8004();
    console.log("RaxcAgentERC8004 deployed at:", address(raxc));

    // Register agent — metadataURI is empty since we don't use it
    uint256 agentId = raxc.register(name, version, "");
    console.log("Registered as agent #%s", agentId);

    vm.stopBroadcast();

    console.log("\nAdd to backend/.env:");
    console.log("AGENT_ERC8004=%s", address(raxc));
    console.log("AGENT_ERC8004_ID=%s", agentId);
  }
}
