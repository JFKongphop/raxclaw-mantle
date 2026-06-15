import { NextRequest, NextResponse } from 'next/server';
import { decrypt } from 'eciesjs';
import * as crypto from 'crypto';

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || 'https://rpc.sepolia.mantle.xyz';
const PRIVATE_KEY = process.env.PRIVATE_KEY || '';
const CONTRACT_ADDR = process.env.NEXT_PUBLIC_RAXC_AGENT || '0x9eD9190d6B2a57444020a7C4461f8A17B0638d4e';

async function rpcCall(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

// Decode ABI-encoded bytes from raw eth_call return
function abiDecodeBytes(hex: string): string {
  const data = hex.startsWith('0x') ? hex.slice(2) : hex;
  const offset = parseInt(data.slice(0, 64), 16) * 2; // offset to data
  const length = parseInt(data.slice(offset, offset + 64), 16) * 2; // byte length * 2 for hex
  return '0x' + data.slice(offset + 64, offset + 64 + length);
}

// isEncrypted(uint256) selector = 0xb593cd1c, getEncryptedKey(uint256) = 0x3171cede
async function isEncrypted(recordId: bigint): Promise<{ encrypted: boolean; encryptedKey: string }> {
  const encCallData = '0xb593cd1c' + recordId.toString(16).padStart(64, '0');
  const encResult = await rpcCall('eth_call', [{ to: CONTRACT_ADDR, data: encCallData }, 'latest']) as string;
  const encrypted = BigInt(encResult) !== BigInt(0);

  let encryptedKey = '';
  if (encrypted) {
    const keyCallData = '0x3171cede' + recordId.toString(16).padStart(64, '0');
    const rawKey = await rpcCall('eth_call', [{ to: CONTRACT_ADDR, data: keyCallData }, 'latest']) as string;
    encryptedKey = abiDecodeBytes(rawKey);
  }

  return { encrypted, encryptedKey };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const recordId = BigInt(params.id);

    // Read reportData(uint256) — selector 0xcc235b2f
    const reportCallData = '0xcc235b2f' + recordId.toString(16).padStart(64, '0');
    const reportHex = await rpcCall('eth_call', [{ to: CONTRACT_ADDR, data: reportCallData }, 'latest']) as string;

    const hex = reportHex.slice(2);
    const offset = parseInt(hex.slice(0, 64), 16) * 2;
    const len = parseInt(hex.slice(offset, offset + 64), 16) * 2;
    const dataHex = hex.slice(offset + 64, offset + 64 + len);

    // Check if encrypted
    const { encrypted, encryptedKey } = await isEncrypted(recordId);

    if (!encrypted) {
      // Plain text — decode and return
      const bytes = new Uint8Array(dataHex.length / 2);
      for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(dataHex.slice(i * 2, i * 2 + 2), 16);
      const plaintext = new TextDecoder().decode(bytes);
      return NextResponse.json({ report: plaintext, encrypted: false });
    }

    // Encrypted — decrypt with owner's private key
    if (!PRIVATE_KEY) {
      return NextResponse.json({ error: 'Server private key not configured for decryption' }, { status: 500 });
    }

    const encKeyBytes = new Uint8Array(
      (encryptedKey.slice(2).match(/.{1,2}/g) ?? []).map((b: string) => parseInt(b, 16)),
    );

    // ECIES decrypt the AES key
    const ownerKey = PRIVATE_KEY.startsWith('0x') ? PRIVATE_KEY.slice(2) : PRIVATE_KEY;
    const aesKey = decrypt(Buffer.from(ownerKey, 'hex'), Buffer.from(encKeyBytes));

    // AES-256-GCM decrypt the report
    const reportBytes = new Uint8Array(dataHex.length / 2);
    for (let i = 0; i < reportBytes.length; i++) reportBytes[i] = parseInt(dataHex.slice(i * 2, i * 2 + 2), 16);

    const iv = reportBytes.slice(0, 12);
    const authTag = reportBytes.slice(-16);
    const ciphertext = reportBytes.slice(12, -16);

    const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, iv);
    decipher.setAuthTag(Buffer.from(authTag));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertext)), decipher.final()]);
    return NextResponse.json({ report: new TextDecoder().decode(plaintext), encrypted: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
