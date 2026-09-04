declare module '@dt-uagent/multi-agent-sdk' {
  interface IMultiAgentChatWindowConfig {
    apiBaseUrl?: string;
    appKey?: string;
    forwardedProps?: Record<string, string>;
    locale?: 'zh-CN' | 'en-US';
  }

  interface IMultiAgentChatWindowOptions {
    container?: HTMLElement;
    themeMode?: 'light' | 'dark' | 'auto';
  }

  interface IMultiAgentChatWindowInstance {
    sendMessage(content: string, forwardedProps?: Record<string, string>): void;
    destroy: () => void;
  }

  export function init(config: IMultiAgentChatWindowConfig, options?: IMultiAgentChatWindowOptions): IMultiAgentChatWindowInstance;

  export const MultiAgentChatWindow: React.ComponentType<{
    config: IMultiAgentChatWindowConfig;
    themeMode?: 'light' | 'dark' | 'auto';
    floating?: boolean;
  }>;
}
