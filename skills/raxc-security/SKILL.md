---
name: raxc-security-audit
description: Autonomous smart contract security audit using 782 real DeFi exploits from Qdrant. Detects reentrancy, flash loan attacks, access control vulnerabilities and more using RAXC multi-agent cognition engine on Mantle Sepolia.
metadata: {"openclaw": {"emoji": "🦀", "requires": {"bins": ["bun"]}, "homepage": "https://github.com/JFKongphop/raxclaw-mantle"}}
---

# RAXC Security Audit Skill

When the user asks to **audit**, **analyze**, **check**, or **scan** a Solidity smart contract for vulnerabilities — use this skill.

## What RAXC Does

RAXC is an autonomous security cognition engine. It runs a 13-phase multi-agent pipeline:

1. **MemoryTool** — loads past audit history from Mantle Sepolia via RaxcAgentERC8004
2. **PatternDetector** — static analysis for reentrancy, access control, flash loan patterns
3. **RaxcAnalyzer** — RAG search across 782 real DeFi exploits (cosine similarity via Qdrant)
4. **LLM** — GPT-4o-mini reasoning with exploit context injected
5. **Consensus Engine** — multi-agent vote → deterministic verdict
6. **AttackSimulator** — 8-step deterministic attack execution path
7. **GraphConstructor** — attack graph (nodes + edges)
8. **ConsistencyVerifier** — cross-checks simulation vs graph vs tools
9. **FinalDecision** — single authority verdict
10. **Attestation** — replay ID + execution trace hash
11. **ReflectionTool** — LLM self-critique, removes hallucinations
12. **On-Chain Storage** — ECIES-encrypted audit report on Mantle Sepolia
13. **RaxcAgentERC8004** — single contract for audit records + long-context memory

## How to Invoke

```bash
bash {baseDir}/run.sh
```

## What It Returns

- Vulnerability type (Reentrancy / FlashLoan / AccessControl / None)
- Risk level (CRITICAL / HIGH / MEDIUM / LOW / NONE)
- Confidence score (0–100%)
- Attack simulation: 8-step execution path, success probability
- Attack graph: nodes + edges + root node
- Consistency score across all verification checks
- Replay ID — deterministic reproduction identifier
- Execution trace hash — verifiable attestation
- On-chain TX hashes — memory + audit records on Mantle Sepolia

## Example Output

```
[OpenClaw]       Matched skill → raxc-security-audit
[OpenClaw]       Building execution graph...
[Planner]        Selecting tools: PatternDetector, MemoryTool, RaxcAnalyzer, ReflectionTool
[Planner]        Dispatching to RAXC cognition engine...

[RAXC]           Starting autonomous security analysis...
[MemoryTool]     Loaded 3 past audits from Mantle Sepolia
[RaxcAnalyzer]   Querying 782-exploit RAG database (Qdrant)...
[LLM]            Sending for analysis...
[RAXC]           Running consensus engine...
[ReflectionTool] LLM self-critique...
[On-Chain]       Storing encrypted audit report...
[RaxcAgentERC8004] Intelligence updated on-chain (Mantle Sepolia, chain 5003)
```

## Environment Required

Copy `.env.example` to `.env` and fill in:
- `PRIVATE_KEY` — Mantle Sepolia wallet private key
- `AGENT_ERC8004` — RaxcAgentERC8004 contract address
- `MANTLE_SEPOLIA` — Mantle Sepolia RPC endpoint

## Architecture

```
OpenClaw Orchestrator
    ↓ matches raxc-security-audit skill
    ↓ calls run.sh
RAXC TypeScript Cognition Engine (Bun)
    ↓ RAG: 782 real DeFi exploits on Qdrant Cloud
    ↓ LLM: GPT-4o-mini (OpenAI)
    ↓ Memory: RaxcAgentERC8004 on-chain (Mantle Sepolia)
RaxcAgentERC8004 — Audit Records + Long-Context Memory (Mantle Sepolia, chain 5003)
```
