'use client';

import { createTheme, MantineProvider } from '@mantine/core';
import type { ReactNode } from 'react';

const theme = createTheme({
  primaryColor: 'fire',
  colors: {
    fire: ['#fff4f2', '#ffe5e1', '#ffc9c2', '#ffaaa0', '#f58679', '#dc5b4f', '#bd4238', '#96332d', '#742822', '#531b18'],
  },
  fontFamily: '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", system-ui, sans-serif',
  headings: {
    fontFamily: '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", system-ui, sans-serif',
    fontWeight: '650',
  },
  defaultRadius: 'sm',
  radius: { xs: '3px', sm: '4px', md: '6px', lg: '8px', xl: '10px' },
  primaryShade: { light: 6, dark: 5 },
  shadows: {
    xs: '0 1px 2px rgba(15, 23, 42, 0.04)',
    sm: '0 2px 5px rgba(15, 23, 42, 0.07)',
    md: '0 8px 22px rgba(15, 23, 42, 0.10)',
    lg: '0 16px 34px rgba(15, 23, 42, 0.14)',
    xl: '0 24px 48px rgba(15, 23, 42, 0.17)',
  },
  components: {
    Button: { defaultProps: { size: 'sm' } },
    ActionIcon: { defaultProps: { size: 'md', variant: 'subtle' } },
    Select: { defaultProps: { size: 'sm', comboboxProps: { shadow: 'md' } } },
  },
});

export function AppProvider({ children }: { children: ReactNode }) {
  return <MantineProvider theme={theme} defaultColorScheme="dark">{children}</MantineProvider>;
}
