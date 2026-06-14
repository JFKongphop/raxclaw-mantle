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
import { decrypt, encrypt, PrivateKey } from "eciesjs";

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
    name: "finalizeAuditEncrypted",
    inputs: [
      { type: "uint256", name: "recordId" },
      { type: "uint8", name: "riskLevel" },
      { type: "uint64", name: "confidence" },
      { type: "string", name: "vulnType" },
      { type: "bytes", name: "encryptedReport" },
      { type: "bytes", name: "encryptedAesKey" },
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
  // ── Audit struct helpers ──
  {
    type: "function",
    name: "isEncrypted",
    inputs: [{ type: "uint256", name: "" }],
    outputs: [{ type: "bool", name: "" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getEncryptedKey",
    inputs: [{ type: "uint256", name: "" }],
    outputs: [{ type: "bytes", name: "" }],
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
  private ownerKey: string; // hex-encoded private key for ECIES decryption

  constructor(
    privateKey: `0x${string}`,
    rpcUrl: string,
    contractAddr: `0x${string}`,
  ) {
    this.account = privateKeyToAccount(privateKey);
    this.rpcUrl = rpcUrl;
    this.contractAddr = contractAddr;
    this.ownerKey = (privateKey.startsWith("0x") ? privateKey.slice(2) : privateKey);
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

  /** Finalize an audit with ECIES-encrypted report (owner-only readable). */
  async finalizeAuditEncrypted(
    taskId: bigint,
    risk: number,
    confidence: bigint,
    vulnType: string,
    report: string,
  ): Promise<string> {
    const crypto = await import("node:crypto");

    // 1. Generate random AES-256 key + IV
    const aesKey = crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);

    // 2. AES-256-GCM encrypt the report
    const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, iv);
    const reportBytes = new TextEncoder().encode(report);
    const encrypted = Buffer.concat([cipher.update(reportBytes), cipher.final()]);
    const authTag = cipher.getAuthTag();
    // Pack: IV (12) + ciphertext + authTag (16)
    const encReport = Buffer.concat([iv, encrypted, authTag]);
    const encReportHex = `0x${encReport.toString("hex")}` as `0x${string}`;

    // 3. ECIES-encrypt the AES key with owner's public key
    const ownerSk = PrivateKey.fromHex(this.ownerKey);
    const ownerPubHex = ownerSk.publicKey.toHex();
    const encKey = encrypt(ownerPubHex, Buffer.from(aesKey));
    const encKeyHex = `0x${Buffer.from(encKey).toString("hex")}` as `0x${string}`;

    // 4. Send to contract
    const hash = await this.walletClient.writeContract({
      account: this.account,
      chain: mantleSepolia,
      address: this.contractAddr,
      abi: AGENT_ABI,
      functionName: "finalizeAuditEncrypted",
      args: [taskId, risk, confidence, vulnType, encReportHex, encKeyHex],
    });

    await this.publicClient.waitForTransactionReceipt({ hash });
    console.log(
      `\x1b[35m[Audit]\x1b[0m         Record #${taskId} finalized (encrypted) | TX: ${hash}`,
    );
    return hash;
  }

  /** Read a finalized report from on-chain (raw hex). */
  async getReport(taskId: bigint): Promise<string> {
    const result = await this.publicClient.readContract({
      address: this.contractAddr,
      abi: AGENT_ABI,
      functionName: "reportData",
      args: [taskId],
    });
    return result as string; // hex string with 0x prefix
  }

  /** Read and decrypt a report (handles both plain and ECIES-encrypted). */
  async getReportDecrypted(taskId: bigint): Promise<string> {
    const rawHex = await this.getReport(taskId);

    // Check if this record is encrypted via the helper
    const encrypted = (await this.publicClient.readContract({
      address: this.contractAddr,
      abi: AGENT_ABI,
      functionName: "isEncrypted",
      args: [taskId],
    })) as boolean;

    // Convert hex to bytes
    const hexToBytes = (hex: string) =>
      new Uint8Array((hex.slice(2).match(/.{1,2}/g) ?? []).map((b) => parseInt(b, 16)));

    if (!encrypted) {
      return new TextDecoder().decode(hexToBytes(rawHex));
    }

    // Read the ECIES-encrypted AES key
    const encryptedKeyHex = (await this.publicClient.readContract({
      address: this.contractAddr,
      abi: AGENT_ABI,
      functionName: "getEncryptedKey",
      args: [taskId],
    })) as string;
    const encKeyBytes = hexToBytes(encryptedKeyHex);

    // ECIES decrypt the AES key
    const aesKey = decrypt(Buffer.from(this.ownerKey, "hex"), Buffer.from(encKeyBytes));

    // AES-256-GCM decrypt the report
    const reportBytes = hexToBytes(rawHex);
    const iv = reportBytes.slice(0, 12);
    const authTag = reportBytes.slice(-16);
    const ciphertext = reportBytes.slice(12, -16);

    const crypto = await import("node:crypto");
    const decipher = crypto.createDecipheriv("aes-256-gcm", aesKey, iv);
    decipher.setAuthTag(Buffer.from(authTag));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertext)), decipher.final()]);
    return new TextDecoder().decode(plaintext);
  }
}
