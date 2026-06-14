/*!
RAXC Contract Client — on-chain audit records & long-context memory via Mantle Sepolia.
Single contract: RaxcAgentERC8004 (combines AgentMemory + AuditReport).
*/

import {
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { defineChain } from "viem";

// ─── Mantle Sepolia Testnet ───────────────────────────────────────────────────

const mantleSepolia = defineChain({
  id: 5003,
  name: "Mantle Sepolia Testnet",
  nativeCurrency: { name: "Mantle", symbol: "MNT", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.sepolia.mantle.xyz"] } },
  blockExplorers: { default: { name: "Mantle Explorer", url: "https://explorer.sepolia.mantle.xyz" } },
  testnet: true,
});

// ─── RaxcAgentERC8004 ABI ─────────────────────────────────────────────────────

const AGENT_ABI = [
  // ── Audit ──
  {
    type: "function",
    name: "createAudit",
    inputs: [{ type: "string", name: "contractName" }],
    outputs: [{ type: "uint256", name: "recordId" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "finalizeAudit",
    inputs: [
      { type: "uint256", name: "recordId" },
      { type: "uint8", name: "riskLevel" },
      { type: "uint64", name: "confidence" },
      { type: "string", name: "vulnType" },
      { type: "bytes", name: "reportMarkdown" },
    ],
    outputs: [{ type: "uint256", name: "achievementId" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "reportData",
    inputs: [{ type: "uint256", name: "" }],
    outputs: [{ type: "bytes", name: "" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "recordCount",
    inputs: [],
    outputs: [{ type: "uint256", name: "" }],
    stateMutability: "view",
  },
  // ── Memory ──
  {
    type: "function",
    name: "pushMemory",
    inputs: [
      { type: "bytes", name: "summaryJson" },
      { type: "string", name: "description" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "memoryData",
    inputs: [{ type: "uint256", name: "" }],
    outputs: [{ type: "bytes", name: "" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "memoryCount",
    inputs: [],
    outputs: [{ type: "uint256", name: "" }],
    stateMutability: "view",
  },
] as const;

// ─── Client ───────────────────────────────────────────────────────────────────

export class StylusClient {
  private account: PrivateKeyAccount;
  private rpcUrl: string;
  private contractAddr: `0x${string}`;
  private walletClient: WalletClient;
  private publicClient: PublicClient;

  constructor(
    privateKey: `0x${string}`,
    rpcUrl: string,
    contractAddr: `0x${string}`,
  ) {
    this.account = privateKeyToAccount(privateKey);
    this.rpcUrl = rpcUrl;
    this.contractAddr = contractAddr;
    this.walletClient = createWalletClient({
      chain: mantleSepolia,
      transport: http(rpcUrl),
      account: this.account,
    });
    this.publicClient = createPublicClient({
      chain: mantleSepolia,
      transport: http(rpcUrl),
    });
  }

  static async fromEnv(): Promise<StylusClient> {
    const rpc = process.env["MANTLE_SEPOLIA"];
    if (!rpc) throw new Error("MANTLE_SEPOLIA not set");
    const pk = process.env["PRIVATE_KEY"];
    if (!pk) throw new Error("PRIVATE_KEY not set");
    const contractAddr = process.env["AGENT_ERC8004"];
    if (!contractAddr) throw new Error("AGENT_ERC8004 not set");

    return new StylusClient(
      pk as `0x${string}`,
      rpc,
      contractAddr as `0x${string}`,
    );
  }

  /** Push JSON summary to on-chain memory. Returns tx hash. */
  async pushMemory(json: string, desc: string): Promise<string> {
    const jsonBytes = new TextEncoder().encode(json);
    const hexBytes = `0x${Array.from(jsonBytes, (b) => b.toString(16).padStart(2, "0")).join("")}` as `0x${string}`;

    const hash = await this.walletClient.writeContract({
      account: this.account,
      chain: mantleSepolia,
      address: this.contractAddr,
      abi: AGENT_ABI,
      functionName: "pushMemory",
      args: [hexBytes, desc],
    });

    await this.publicClient.waitForTransactionReceipt({ hash });
    console.log(`\x1b[94m[Memory]\x1b[0m         Pushed             | TX: ${hash}`);
    return hash;
  }

  /** Read all past memory entries from on-chain (up to 50). */
  async readAllMemory(): Promise<Array<{ index: bigint; data: string }>> {
    const total = await this.publicClient.readContract({
      address: this.contractAddr,
      abi: AGENT_ABI,
      functionName: "memoryCount",
    });

    const count = total as bigint;
    const maxRead = count < 50n ? Number(count) : 50;
    const entries: Array<{ index: bigint; data: string }> = [];

    for (let i = 0; i < maxRead; i++) {
      try {
        const bytes = await this.publicClient.readContract({
          address: this.contractAddr,
          abi: AGENT_ABI,
          functionName: "memoryData",
          args: [BigInt(i)],
        });
        entries.push({
          index: BigInt(i),
          data: new TextDecoder().decode(
            Uint8Array.from(
              ((bytes as string).slice(2).match(/.{1,2}/g) ?? []).map((b) => parseInt(b, 16)),
            ),
          ),
        });
      } catch {
        // skip failed reads
      }
    }

    return entries;
  }

  /** Create an audit record. Returns record ID. */
  async createAuditTask(name: string): Promise<bigint> {
    const current = (await this.publicClient.readContract({
      address: this.contractAddr,
      abi: AGENT_ABI,
      functionName: "recordCount",
    })) as bigint;

    const hash = await this.walletClient.writeContract({
      account: this.account,
      chain: mantleSepolia,
      address: this.contractAddr,
      abi: AGENT_ABI,
      functionName: "createAudit",
      args: [name],
    });

    await this.publicClient.waitForTransactionReceipt({ hash });
    console.log(
      `\x1b[35m[Audit]\x1b[0m         Record #${current} created   | TX: ${hash}`,
    );
    return current;
  }

  /** Finalize an audit with full markdown report. */
  async finalizeAudit(
    taskId: bigint,
    risk: number,
    confidence: bigint,
    vulnType: string,
    report: string,
  ): Promise<string> {
    const reportBytes = new TextEncoder().encode(report);
    const hexBytes = `0x${Array.from(reportBytes, (b) => b.toString(16).padStart(2, "0")).join("")}` as `0x${string}`;

    const hash = await this.walletClient.writeContract({
      account: this.account,
      chain: mantleSepolia,
      address: this.contractAddr,
      abi: AGENT_ABI,
      functionName: "finalizeAudit",
      args: [taskId, risk, confidence, vulnType, hexBytes],
    });

    await this.publicClient.waitForTransactionReceipt({ hash });
    console.log(
      `\x1b[35m[Audit]\x1b[0m         Record #${taskId} finalized | TX: ${hash}`,
    );
    return hash;
  }

  /** Read a finalized report from on-chain. */
  async getReport(taskId: bigint): Promise<string> {
    const result = await this.publicClient.readContract({
      address: this.contractAddr,
      abi: AGENT_ABI,
      functionName: "reportData",
      args: [taskId],
    });

    return new TextDecoder().decode(
      Uint8Array.from(
        ((result as string).slice(2).match(/.{1,2}/g) ?? []).map((b) => parseInt(b, 16)),
      ),
    );
  }
}
