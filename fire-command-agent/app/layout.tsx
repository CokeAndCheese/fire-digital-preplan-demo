import type { Metadata } from 'next';
import '@mantine/core/styles.css';
import './globals.css';
import { AppProvider } from '@/components/AppProvider';

export const metadata: Metadata = {
  title: '三亚消防指挥智能体',
  description: '独立消防指挥智能体与 Skill 调度工作台',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body><AppProvider>{children}</AppProvider></body>
    </html>
  );
}
