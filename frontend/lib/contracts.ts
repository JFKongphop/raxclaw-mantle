import { JsonRpcProvider, Contract } from 'ethers';

// ── Mantle Sepolia — RaxcAgentERC8004 ──────────────────────────────────────────
export const RPC_URL = '/api/rpc'; // Next.js API proxy → Mantle Sepolia
export const CHAIN_ID = 5003;

// ── Deployed contract address ─────────────────────────────────────────────────
export const ADDRESSES = {
  raxcAgent: '0x9eD9190d6B2a57444020a7C4461f8A17B0638d4e',
} as const;
// Legacy aliases (backward compat)
const AGENT_ADDR = ADDRESSES.raxcAgent;

// ── RaxcAgentERC8004 ABI ──────────────────────────────────────────────────────
const AGENT_ABI = [
  // Audit
  'function recordCount() view returns (uint256)',
  'function reportData(uint256 index) view returns (bytes)',
  'event AuditCreated(uint256 indexed erc8004Id, uint256 indexed recordId, string contractName, uint256 timestamp)',
  'event AuditFinalized(uint256 indexed erc8004Id, uint256 indexed recordId, uint8 riskLevel, uint64 confidence, bytes32 reportHash, uint256 achievementId, uint256 timestamp)',
  // Memory
  'function memoryCount() view returns (uint256)',
  'function memoryData(uint256 index) view returns (bytes)',
  'event MemoryPushed(uint256 indexed erc8004Id, uint256 indexed entryIndex, bytes32 contentHash, uint256 timestamp)',
];

export interface ChainStats {
  auditsCompleted: number;
  replayTraces: number;
  rootHashesStored: number;
  erc7857Updates: number;
  online: boolean;
}

/**
 * Read live stats from RaxcAgentERC8004 via API proxy.
 */
export async function fetchChainStats(): Promise<ChainStats> {
  try {
    const rpc = (method: string, params: unknown[]) =>
      fetch(RPC_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
        .then(r => r.json()).then(j => j.result);

    // memoryCount() selector = 0xc2c1fa4b, recordCount() = 0x900407bc
    const [memResult, audResult] = await Promise.all([
      rpc('eth_call', [{ to: AGENT_ADDR, data: '0xc2c1fa4b' }, 'latest']).catch(() => '0x0'),
      rpc('eth_call', [{ to: AGENT_ADDR, data: '0x900407bc' }, 'latest']).catch(() => '0x0'),
    ]);

    const mc = parseInt(memResult, 16) || 0;
    const ac = parseInt(audResult, 16) || 0;

    return { auditsCompleted: ac, replayTraces: ac, rootHashesStored: mc, erc7857Updates: mc, online: true };
  } catch {
    return { auditsCompleted: 0, replayTraces: 0, rootHashesStored: 0, erc7857Updates: 0, online: false };
  }
}

// ── On-chain audit fetchers ───────────────────────────────────────────────────

export interface OnChainAudit {
  taskId: string;
  rootHash: string;
  verdict: string;
  replayId: string;
  completedAt: Date;
  txHash?: string;
  contractName?: string;
  confidence?: number;
  traceHash?: string;
  requester?: string;
}

const RISK_LABELS = ['None', 'Low', 'Medium', 'High', 'Critical'];

// Event topic hashes (keccak256 of the new contract events)
const TOPIC_AUDIT_CREATED   = '0x7b9f05d4afd60bfaaf60d800f7e291e31d627323d108fa7072fc1332849f1291';
const TOPIC_AUDIT_FINALIZED = '0x6e3f7ee7555143b9cc08078ac295a4698488917c7a2d1046fbe0c5326d4a7e40';

/**
 * Fetch finalized audit records by querying raw eth_getLogs via the API proxy.
 * No ethers.js — raw fetch avoids CORS issues.
 */
export async function fetchAuditTasks(): Promise<OnChainAudit[]> {
  try {
    const body = (method: string, params: unknown[]) =>
      JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });

    // Get latest block
    const latestHex = await fetch(RPC_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: body('eth_blockNumber', []) })
      .then(r => r.json()).then(j => j.result).catch(() => '0x261be00');
    const latest = parseInt(latestHex, 16);

    // Paginate across 10k-block windows to cover full contract history
    const WINDOW = 10000;
    const createdLogsAll: unknown[] = [];
    const finalizedLogsAll: unknown[] = [];

    for (let from = Math.max(0, latest - 100000); from < latest; from += WINDOW) {
      const to = Math.min(from + WINDOW - 1, latest);
      const [cLogs, fLogs] = await Promise.all([
        fetch(RPC_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: body('eth_getLogs', [{ address: AGENT_ADDR, topics: [TOPIC_AUDIT_CREATED], fromBlock: '0x' + from.toString(16), toBlock: '0x' + to.toString(16) }]) })
          .then(r => r.json()).then(j => j.result || []).catch(() => []),
        fetch(RPC_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: body('eth_getLogs', [{ address: AGENT_ADDR, topics: [TOPIC_AUDIT_FINALIZED], fromBlock: '0x' + from.toString(16), toBlock: '0x' + to.toString(16) }]) })
          .then(r => r.json()).then(j => j.result || []).catch(() => []),
      ]);
      createdLogsAll.push(...(cLogs as unknown[]));
      finalizedLogsAll.push(...(fLogs as unknown[]));
    }

    // Index AuditCreated by recordId (topics[2])
    const createdByTask = new Map<string, { contractName: string; requester: string }>();
    for (const log of createdLogsAll) {
      const logItem = log as { topics: string[]; data: string; transactionHash: string };
      const recordId = BigInt(logItem.topics[2]).toString();
      const data = logItem.data;
      const offset = parseInt(data.slice(2, 66), 16) * 2;
      const strLen = parseInt(data.slice(2 + offset, 2 + offset + 64), 16) * 2;
      const strHex = data.slice(2 + offset + 64, 2 + offset + 64 + strLen);
      const contractName = decodeURIComponent(strHex.replace(/[0-9a-f]{2}/g, '%$&'));
      createdByTask.set(recordId, {
        contractName,
        requester: '',
      });
    }

    const tasks: OnChainAudit[] = [];
    for (const log of finalizedLogsAll.reverse()) {
      const logItem = log as { topics: string[]; data: string; transactionHash: string };
      const recordId = BigInt(logItem.topics[2]).toString();
      const created = createdByTask.get(recordId);
      const data = logItem.data.slice(2);
      const riskLevel = parseInt(data.slice(0, 64), 16);
      const confidence = parseInt(data.slice(64, 128), 16);
      const reportHash = '0x' + data.slice(128, 192);
      // achievementId at 192-256, timestamp at 256-320
      const timestamp = parseInt(data.slice(256, 320), 16);

      tasks.push({
        taskId: recordId,
        rootHash: reportHash,
        verdict: RISK_LABELS[riskLevel] ?? 'Unknown',
        replayId: '',
        completedAt: new Date(timestamp * 1000),
        txHash: logItem.transactionHash,
        contractName: created?.contractName ?? `Audit #${recordId}`,
        confidence,
        requester: created?.requester ?? '',
      });
    }
    return tasks;
  } catch {
    return [];
  }
}

export async function fetchAuditTask(_taskId: string): Promise<OnChainAudit | null> {
  return null;
}

function verdictToSeverity(verdict: string): 'critical' | 'high' | 'medium' | 'low' {
  const v = verdict.toUpperCase();
  if (v.includes('CRITICAL')) return 'critical';
  if (v.includes('HIGH'))     return 'high';
  if (v.includes('MEDIUM'))   return 'medium';
  return 'low';
}

export { verdictToSeverity };

export const OG_STORAGE_GATEWAY = 'https://sepolia.mantlescan.xyz';

export interface RootHashEntry {
  rootHash: string;
  dataKey: string;
  tokenId: string;
}

export async function fetchERC7857RootHashes(): Promise<RootHashEntry[]> {
  return [];
}
