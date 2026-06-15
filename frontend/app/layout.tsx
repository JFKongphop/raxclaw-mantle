import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'RAXCLAW — Autonomous Security Cognition on Mantle',
  description:
    'Autonomous AI Security Agent for Smart Contract Auditing on Mantle. Replayable intelligence, deterministic execution, cryptographic verification.',
  icons: { icon: '/icon.png', apple: '/icon.png' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}
