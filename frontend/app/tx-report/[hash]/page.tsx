'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ADDRESSES } from '@/lib/contracts';

const RPC_PROXY = '/api/rpc';
const TOPIC_AUDIT_FINALIZED = '0x6e3f7ee7555143b9cc08078ac295a4698488917c7a2d1046fbe0c5326d4a7e40';
const RISK_LABELS = ['None', 'Low', 'Medium', 'High', 'Critical'];

function isTxHash(h: string): boolean { return /^0x[0-9a-fA-F]{64}$/.test(h); }

async function rpcCall(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(RPC_PROXY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

async function fetchReportFromChain(txHash: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const receipt = await rpcCall('eth_getTransactionReceipt', [txHash]) as Record<string, unknown> | null;
      if (!receipt || !receipt.logs) return null;
      const logs = receipt.logs as Array<{ address: string; topics: string[]; data: string }>;
      const log = logs.find(l => l.address.toLowerCase() === ADDRESSES.raxcAgent.toLowerCase() && l.topics[0] === TOPIC_AUDIT_FINALIZED);
      if (!log) return null;

      // AuditFinalized event: erc8004Id, recordId, riskLevel, confidence, reportHash, achievementId, timestamp
      const recordId = BigInt(log.topics[2]);
      const data = log.data.slice(2);
      const riskLevel = parseInt(data.slice(0, 64), 16);
      const confidence = parseInt(data.slice(64, 128), 16);
      const reportHash = '0x' + data.slice(128, 192);
      // achievementId at 192-256, timestamp at 256-320
      const timestamp = parseInt(data.slice(256, 320), 16);

      // Fetch and auto-decrypt report via backend API (handles ECIES encryption)
      const reportRes = await fetch(`/api/report/${recordId.toString()}`);
      const reportJson = await reportRes.json();
      const report = reportJson.report || '';

      return {
        report,
        taskId: recordId.toString(),
        riskLevel: RISK_LABELS[riskLevel] ?? 'Unknown',
        confidence,
        reportHash,
        completedAt: new Date(timestamp * 1000),
      };
    } catch {
      if (attempt < 2) await new Promise(r => setTimeout(r, (attempt + 1) * 1500));
    }
  }
  return null;
}

export default function RootHashPage() {
  const router = useRouter();
  const params = useParams<{ hash: string }>();
  const hash = params.hash;
  const tx = isTxHash(hash);

  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [meta, setMeta] = useState<{ taskId: string; reportHash: string; riskLevel: string; confidence: number; completedAt: Date } | null>(null);

  const load = useCallback(async () => {
    if (!tx) { setLoading(false); return; }
    setLoading(true);
    const result = await fetchReportFromChain(hash);
    if (result) {
      setContent(result.report);
      setMeta({ taskId: result.taskId, reportHash: result.reportHash, riskLevel: result.riskLevel, confidence: result.confidence, completedAt: result.completedAt });
    } else {
      setFailed(true);
    }
    setLoading(false);
  }, [hash]);

  useEffect(() => { load(); }, [load]);

  return (
    <main style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)' }}>
      <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', padding: '16px 32px', display: 'flex', alignItems: 'center', gap: 20 }}>
        <button onClick={() => router.push('/#audits')} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.15)', color: 'var(--text)', borderRadius: 6, padding: '6px 16px', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
          &#8592; Back
        </button>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-dim)' }}>
          {tx ? 'Mantle Sepolia · Audit Report' : 'Root Hash'}
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '40px 32px 80px' }}>
        {/* Header card */}
        <div className="glass-card" style={{ padding: '20px 24px', marginBottom: 32 }}>
          <div style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--cyan)', fontFamily: 'var(--font-mono)', marginBottom: 10 }}>
            {tx ? 'On-Chain Audit Report' : 'Root Hash'}
          </div>

          {tx && meta ? (
            <a
              href={`https://sepolia.mantlescan.xyz/tx/${hash}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: 'flex', flexDirection: 'column', gap: 8, textDecoration: 'none', color: 'inherit' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-dim)' }}>Task #{meta.taskId}</span>
                <span style={{ color: 'rgba(255,255,255,0.15)' }}>|</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: meta.riskLevel === 'High' || meta.riskLevel === 'Critical' ? 'var(--red)' : 'var(--yellow)' }}>{meta.riskLevel}</span>
                <span style={{ color: 'rgba(255,255,255,0.15)' }}>|</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--green)' }}>{meta.confidence}%</span>
                <span style={{ color: 'rgba(255,255,255,0.15)' }}>|</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>{meta.completedAt.toLocaleString()}</span>
              </div>
              <div className="hash" style={{ fontSize: 12, wordBreak: 'break-all' }}>{hash}</div>
            </a>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="hash" style={{ fontSize: 12, wordBreak: 'break-all', flex: 1 }}>{hash}</span>
            </div>
          )}

          {failed && (
            <div style={{ marginTop: 14, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--yellow)' }}>
              {tx ? '⚠ Could not read report from on-chain contract.' : '⚠ Hash not found.'}
            </div>
          )}
        </div>

        {/* Report content */}
        {tx && loading && (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-dim)' }}>
            Fetching report from Mantle Sepolia…
          </div>
        )}
        {tx && content && (
          <div className="report-content">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        )}
      </div>
    </main>
  );
}
