import type {
  AgentConfigResponse,
  ChatMessage,
  ClientToolsMap,
  ConversationFeedback,
  ConversationFeedbackSentiment,
  EmcyEmbeddedAuthIdentity,
  EmcyStorageLike,
  McpServerAuthConfig,
  OAuthTokenResponse,
  SseError,
} from '../core/types';

export type HostActionsMap = ClientToolsMap;
export type AppAgentUserIdentity = EmcyEmbeddedAuthIdentity;

export interface KeyValueStore {
  getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void;
  removeItem(key: string): Promise<void> | void;
}

export interface OAuthSessionRequest {
  authorizeUrl: string;
  redirectUri: string;
  preferEphemeralSession?: boolean;
}

export type OAuthSessionResult =
  | { type: 'success'; url: string }
  | { type: 'cancel' | 'dismiss' }
  | { type: 'error'; message?: string };

export interface AppAgentPlatform {
  storage?: {
    durable: KeyValueStore;
    secure?: KeyValueStore;
  };
  auth?: {
    openOAuthSession(request: OAuthSessionRequest): Promise<OAuthSessionResult>;
    dismissOAuthSession?(): Promise<void> | void;
  };
  lifecycle?: {
    onForegroundChange?(listener: (isForeground: boolean) => void): () => void;
    onConnectivityChange?(listener: (isOnline: boolean) => void): () => void;
  };
}

export interface AppAgentApproval {
  id: string;
  title: string;
  rationale?: string;
  steps: string[];
  toolCallId?: string | null;
  confirmLabel?: string;
  cancelLabel?: string;
}

export interface AppAgentInputOption {
  label: string;
  value: string;
}

export interface AppAgentInputField {
  key: string;
  label: string;
  kind: 'text' | 'textarea' | 'number' | 'select' | 'boolean';
  required?: boolean;
  placeholder?: string;
  options?: AppAgentInputOption[];
}

export interface AppAgentInputRequest {
  id: string;
  title: string;
  prompt?: string;
  fields: AppAgentInputField[];
  toolCallId?: string | null;
  submitLabel?: string;
  cancelLabel?: string;
}

export interface AppAgentIssue {
  code: 'stale_conversation' | 'runtime_error' | 'config_error';
  message: string;
  recoverable: boolean;
}

export interface AppAgentFeedbackState {
  isSubmitting: boolean;
  error: string | null;
  lastSubmittedAt: string | null;
  lastFeedback: ConversationFeedback | null;
}

export interface AppAgentConnection {
  url: string;
  name: string;
  authStatus: 'connected' | 'needs_auth';
  canSignOut: boolean;
}

export interface AppAgentConversationResumeRecord {
  conversationId: string;
  agentId: string;
  appSessionKey: string | null;
  conversationResumeVersion: string;
  updatedAt: string;
}

export interface AppAgentConfig {
  apiKey: string;
  agentId: string;
  serviceUrl?: string;
  oauthCallbackUrl?: string;
  oauthClientMetadataUrl?: string;
  getAuthToken?: () => Promise<string | undefined>;
  appSessionKey?: string | null;
  userIdentity?: AppAgentUserIdentity;
  useCookies?: boolean;
  externalUserId?: string;
  appContext?: Record<string, unknown>;
  hostActions?: HostActionsMap;
  platform?: AppAgentPlatform;
  onAuthRequired?: (mcpServerUrl: string, authConfig: McpServerAuthConfig) => Promise<OAuthTokenResponse | undefined>;
  conversation?: {
    namespace?: string;
    historyPageSize?: number;
  };
  feedbackSource?: string;
  storage?: EmcyStorageLike | null;
}

export interface AppAgentLifecycleState {
  isReady: boolean;
  isLoading: boolean;
  isLoadingHistory: boolean;
  isThinking: boolean;
  hasOlderMessages: boolean;
  error: SseError | null;
  issue: AppAgentIssue | null;
}

export interface AppAgentSnapshotBase {
  runtime: {
    agent: unknown;
    agentConfig: AgentConfigResponse | null;
  };
  conversation: AppAgentLifecycleState & {
    id: string | null;
    messages: ChatMessage[];
    streamingContent: string;
    statusLabel: string;
    resumeKey: string | null;
  };
  connections: {
    items: AppAgentConnection[];
    needsAttention: boolean;
  };
  approvals: {
    pending: AppAgentApproval[];
  };
  requests: {
    pending: AppAgentInputRequest[];
  };
  feedback: AppAgentFeedbackState;
}

export const APP_AGENT_APPROVAL_ACTION = 'requestApproval';
export const APP_AGENT_INPUT_ACTION = 'requestInput';
