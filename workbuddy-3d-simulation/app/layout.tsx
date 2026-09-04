import type { Metadata } from 'next';
import { UStudioVideoDialog } from '@/components/UStudioVideoDialog';
import './globals.css';
import '@dt-uagent/multi-agent-sdk/style.css';

export const metadata: Metadata = {
  title: 'UStudio Scene',
  description: 'UStudio scene rendered with SoonSpace',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        {children}
        <UStudioVideoDialog />
      </body>
    </html>
  );
}
