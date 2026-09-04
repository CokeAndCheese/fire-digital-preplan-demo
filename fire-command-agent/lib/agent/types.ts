import type { ThreadMessageLike } from '@assistant-ui/react';

export type AgentApp = {
  app_id: string;
  name: string;
  description?: string;
  status?: string;
};

export type ToolFeedback = {
  toolCallId?: string;
  toolName?: string;
  result: 'APPROVED' | 'REJECTED' | 'STOP';
  description?: string;
  args?: string;
};

export type PresentationStatus = 'running' | 'success' | 'failed' | 'waiting' | 'offline';

export type AuditRecord = {
  callId: string;
  toolName: string;
  status: PresentationStatus;
  input?: unknown;
  output?: unknown;
  evidenceRefs?: string[];
  ruleVersion?: string;
  error?: string;
  startedAt: number;
  finishedAt?: number;
  replayable?: boolean;
};

export type ExecutionTrace = {
  source: 'unknown' | 'local' | 'upstream';
  phase?: string;
  title?: string;
  detail?: string;
  progress?: number;
  status?: PresentationStatus;
};

export type AgentChatRequest = {
  appId: string;
  conversationId?: string;
  content?: string;
  sceneId?: string;
  toolFeedbacks?: ToolFeedback[];
  forwardedProps?: Record<string, unknown>;
  passthroughProps?: Record<string, unknown>;
};

export type AgentStreamEvent = {
  type: string;
  /** Whether the event belongs to the whole run, one child tool, or transport. */
  scope?: 'task' | 'tool' | 'transport';
  /** False means the upstream reported a recoverable child failure. */
  terminal?: boolean;
  conversation_id?: string;
  content?: string;
  agent?: string;
  toolCallId?: string;
  toolName?: string;
  args?: string;
  result?: string;
  description?: string;
  phase?: string;
  elapsedMs?: number;
  title?: string;
  progress?: number;
  status?: 'pending' | 'running' | 'done' | 'waiting' | 'error';
};

export type AgentMessage = ThreadMessageLike & {
  id: string;
  metadata?: ThreadMessageLike['metadata'] & {
    custom?: {
      agent?: string;
      elapsedMs?: number;
      error?: string;
      remote?: boolean;
      reviewRequired?: boolean;
      execution?: ExecutionTrace;
      audit?: AuditRecord[];
      conversationId?: string;
    };
  };
};
