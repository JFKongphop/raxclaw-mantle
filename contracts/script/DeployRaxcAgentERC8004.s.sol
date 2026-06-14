// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/RaxcAgentERC8004.sol";

/// @notice Deploy RaxcAgentERC8004 to Mantle Testnet
/// @dev Run: forge script script/DeployRaxcAgentERC8004.s.sol --rpc-url $RPC --broadcast -vvvv
contract DeployRaxcAgentERC8004 is Script {
  function run() external {
    uint256 deployerKey = vm.envUint("PRIVATE_KEY");

    vm.startBroadcast(deployerKey);

    RaxcAgentERC8004 raxc = new RaxcAgentERC8004();
    console.log("RaxcAgentERC8004 deployed at:", address(raxc));

    vm.stopBroadcast();

    console.log("\nAdd to backend/.env:");
    console.log("AGENT_ERC8004=%s", address(raxc));
    console.log("\nRegister later via cast:");
    console.log("cast send %s \"register(string,string,string)\" \"RAXCLAW\" \"v0.9.1\" \"\" --rpc-url $RPC --private-key $PRIVATE_KEY", address(raxc));
  }
}
