/*!
Example: RAXC Multi-Agent Framework — Sovereign Execution Mode (TypeScript)

Full pipeline: Qdrant (RAG) → OpenAI (LLM) → Mantle Sepolia (on-chain proof).

Prerequisites:
  - Qdrant Cloud: exploit vectors in defi_cases + defi_protocols
  - OpenAI API: GPT-4o-mini + text-embedding-3-small
  - Mantle Sepolia: RaxcAgentERC8004 contract deployed

Run:
    bun run examples/agent-example.ts
*/

import {
  loadEnv,
  buildOpenAiClient,
  QdrantStorageClient,
  StylusClient,
  AgentCore,
  RaxcAnalyzer,
  RaxcAnalyzerRemote,
  GasAnalyzerTool,
  PatternDetectorTool,
  FlashLoanTool,
  AccessControlTool,
  ReflectionTool,
  MemoryTool,
} from "../src/index.ts";
import * as fs from "fs";
import * as path from "path";

// ─── Default demo contract with intentional vulnerabilities ──────────────────
const DEFAULT_CONTRACT = `
// DeFiVault — built-in demo contract
pragma solidity ^0.7.0;

contract DeFiVault {
    mapping(address => uint256) public balances;
    address[] public depositors;

    function deposit() external payable {
        balances[msg.sender] += msg.value;
        depositors.push(msg.sender);
    }

    // ❌ Reentrancy: external call before state update
    function withdraw() external {
        uint256 amount = balances[msg.sender];
        require(amount > 0, "Nothing to withdraw");
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "Transfer failed");
        balances[msg.sender] = 0;
    }
}
`;

async function main(): Promise<void> {
  // Load environment variables
  loadEnv();

  console.log(
    "\x1b[1;96m╔══════════════════════════════════════════════════════════════════════════╗\x1b[0m",
  );
  console.log(
    "\x1b[1;96m║\x1b[0m  \x1b[1;96mRAXC Autonomous Exploit Intelligence Core — Sovereign Execution Mode\x1b[0m    \x1b[1;96m║\x1b[0m",
  );
  console.log(
    "\x1b[1;96m║\x1b[0m         \x1b[2mDeterministic Exploit Execution + Verification Framework\x1b[0m         \x1b[1;96m║\x1b[0m",
  );
  console.log(
    "\x1b[1;96m╚══════════════════════════════════════════════════════════════════════════╝\x1b[0m\n",
  );

  // ─── Connect to Qdrant ────────────────────────────────────────────────────
  console.log("\x1b[33m[*] Connecting to Qdrant...\x1b[0m");
  const qdrant = QdrantStorageClient.fromEnv();
  const loaded = await qdrant.health();
  console.log(
    `\x1b[92m[✓] Qdrant online — ${loaded} total exploit vectors loaded\x1b[0m\n`,
  );

  // ─── Initialize Mantle + OpenAI clients ──────────────────────────────────
  const stylus = await StylusClient.fromEnv();
  const compute = buildOpenAiClient();

  // ─── Create AgentCore ──────────────────────────────────────────────────────
  const core = new AgentCore(qdrant, stylus, compute);

  // ─── Register tools ────────────────────────────────────────────────────────
  console.log("\x1b[33m[*] Registering tools to ToolRegistry...\x1b[0m");  core.tools.register(new RaxcAnalyzer(qdrant, compute));  core.tools.register(new RaxcAnalyzerRemote(qdrant, compute));
  core.tools.register(new GasAnalyzerTool());
  core.tools.register(new PatternDetectorTool());
  core.tools.register(new FlashLoanTool());
  core.tools.register(new AccessControlTool());
  core.tools.register(new ReflectionTool(compute));
  core.tools.register(new MemoryTool(core.memory));

  // ─── Load contract ─────────────────────────────────────────────────────────
  let contractCode: string;
  let contractName: string;

  if (process.env["RAXC_CONTRACT_CODE"]) {
    contractCode = process.env["RAXC_CONTRACT_CODE"];
    const words = contractCode.split(/\s+/);
    const contractIdx = words.findIndex((w) => w === "contract");
    contractName =
      contractIdx !== -1
        ? (words[contractIdx + 1] ?? "Contract").replace(/[^a-zA-Z0-9_]/g, "")
        : "Contract";
    console.log(
      `\x1b[33m[*]\x1b[0m Analyzing inline contract: \x1b[97m${contractName}\x1b[0m`,
    );
  } else if (process.env["RAXC_CONTRACT_FILE"]) {
    const filePath = process.env["RAXC_CONTRACT_FILE"];
    console.log(
      `\x1b[33m[*]\x1b[0m Loading contract from: \x1b[97m${filePath}\x1b[0m`,
    );
    contractCode = fs.readFileSync(filePath, "utf-8");
    contractName =
      path.basename(filePath, path.extname(filePath)) || "Contract";
  } else {
    console.log(
      "\x1b[2m    (no --file given — using built-in DeFiVault demo contract)\x1b[0m",
    );
    contractCode = DEFAULT_CONTRACT;
    contractName = "DeFiVault";
  }

  // ─── Run analysis ──────────────────────────────────────────────────────────
  console.log(
    "\n\x1b[33m[*]\x1b[0m Initiating autonomous exploit analysis — 13-phase verification pipeline...\n",
  );
  const result = await core.analyze(contractCode, contractName);

  // Save markdown report
  const reportsDir = path.resolve("reports");
  fs.mkdirSync(reportsDir, { recursive: true });
  const reportPath = path.join(reportsDir, result.filename);
  fs.writeFileSync(reportPath, result.markdown);
  console.log(`\n\x1b[92m✅ Report saved to: ${reportPath}\x1b[0m\n`);

  console.log(
    "\n\x1b[36m╔══════════════════════════════════════════════════════════════════════════╗\x1b[0m",
  );
  console.log(
    "\x1b[36m║                  AUTONOMOUS EXPLOIT INTELLIGENCE RESULT                  ║\x1b[0m",
  );
  console.log(
    "\x1b[36m╚══════════════════════════════════════════════════════════════════════════╝\x1b[0m\n",
  );

  console.log("\x1b[1;96m📊 BASIC DECISION:\x1b[0m");
  console.log(
    `  Vulnerability Found:  ${result.decision.vulnerabilityFound}`,
  );
  console.log(`  Risk Level:          ${result.decision.riskLevel}`);
  if (result.decision.primaryVulnerability) {
    console.log(
      `  Vulnerability Type:  ${result.decision.primaryVulnerability}`,
    );
  }
  console.log(
    `  Confidence:          ${(result.decision.confidence * 100).toFixed(1)}%`,
  );
  console.log(`  Tool Signals:        ${result.signals.length}\n`);

  // ─── Print intelligence + attack simulation ──────────────────────────────
  console.log("\x1b[1;96m📈 INTELLIGENCE REPORT:\x1b[0m");
  console.log(
    `  Risk Score:          ${(result.intelligenceReport.riskScore * 100).toFixed(1)}%`,
  );
  console.log(
    `  Exploitability:      ${(result.intelligenceReport.exploitabilityScore * 100).toFixed(1)}%`,
  );
  console.log(
    `  Attack Likelihood:   ${(result.intelligenceReport.attackLikelihood * 100).toFixed(1)}%`,
  );

  console.log("\n\x1b[1;96m🧪 ATTACK SIMULATION:\x1b[0m");
  console.log(
    `  Execution Path:      ${result.attackSimulation.executionPath.length} steps`,
  );
  console.log(
    `  Attacker Type:       ${result.attackSimulation.attackerModel.attackerType}`,
  );
  console.log(
    `  Success Prob:        ${(result.attackSimulation.exploitVerdict.successProbability * 100).toFixed(1)}%`,
  );

  console.log("\n\x1b[1;96m📊 ATTACK MAP:\x1b[0m");
  console.log(`  Graph Nodes:         ${result.attackGraph.nodes.length}`);
  console.log(`  Root Node:           ${result.attackGraph.rootNode}`);

  console.log("\n\x1b[1;96m🎯 FINAL DECISION:\x1b[0m");
  console.log(
    `  Final Verdict:       ${result.finalDecision.finalVerdict}`,
  );
  console.log(
    `  Final Confidence:    ${(result.finalDecision.finalConfidence * 100).toFixed(2)}%`,
  );
  console.log(
    `  Final Risk Score:    ${(result.finalDecision.finalRiskScore * 100).toFixed(2)}%`,
  );

  console.log("\n\x1b[1;96m🔐 ATTESTATION:\x1b[0m");
  console.log(
    `  Replay ID:           ${result.attestation.replayId}`,
  );
  console.log(
    `  Trace Hash:          ${result.attestation.executionTraceHash}`,
  );

  console.log(
    "\n\x1b[1;35m╔════════════════════════════════════════════════════════════════════════╗\x1b[0m",
  );
  console.log(
    "\x1b[1;35m║                      ON-CHAIN PROOF — Mantle Sepolia                   ║\x1b[0m",
  );
  console.log(
    "\x1b[1;35m╚════════════════════════════════════════════════════════════════════════╝\x1b[0m\n",
  );
  console.log(
    `\x1b[1;35m\x1b[0m  AgentMemory (JSON): \x1b[92m${result.storageRootHash}\x1b[0m`,
  );
  console.log(
    `\x1b[1;35m\x1b[0m  AuditReport Task #: \x1b[92m${result.reportRootHash}\x1b[0m`,
  );
  console.log(
    `\x1b[1;35m\x1b[0m  AgentMemory TX:     \x1b[94mhttps://sepolia.mantlescan.xyz/tx/${result.storageRootHash}\x1b[0m`,
  );
  console.log(
    `\x1b[1;35m\x1b[0m  AuditReport TX:     \x1b[94mhttps://sepolia.mantlescan.xyz/tx/${result.reportTx}\x1b[0m\n`,
  );
  console.log(
    `\x1b[1;35m\x1b[0m  RAXCLAW REPORT:     \x1b[94mhttps://raxclaw-mantle.vercel.app/tx-report/${result.reportTx}\x1b[0m\n`,
  );

  console.log(
    "\x1b[36m╔══════════════════════════════════════════════════════════════════════════╗\x1b[0m",
  );
  console.log(
    "\x1b[36m║        AUTONOMOUS ENGINE — SOVEREIGN EXECUTION COMPLETE                  ║\x1b[0m",
  );
  console.log(
    "\x1b[36m╚══════════════════════════════════════════════════════════════════════════╝\x1b[0m",
  );
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
