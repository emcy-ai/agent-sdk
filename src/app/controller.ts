import { EmcyAgent } from '../core/EmcyAgent';
import type {
  AgentConfigResponse,
  ChatMessage,
  ConversationFeedback,
  McpServerAuthConfig,
  OAuthTokenResponse,
  SseContentDelta,
  SseError,
  SseToolCall,
  SubmitConversationFeedbackRequest,
} from '../core/types';
import {
  APP_AGENT_APPROVAL_ACTION,
  APP_AGENT_INPUT_ACTION,
  type AppAgentApproval,
  type AppAgentConfig,
  type AppAgentConnection,
  type AppAgentConversationResumeRecord,
  type AppAgentFeedbackState,
  type AppAgentInputField,
  type AppAgentInputRequest,
  type AppAgentIssue,
  type AppAgentSnapshotBase,
} from './types';
import {
  applyUserMessageOverrides,
  buildRenderedNodes,
  createInlinePendingTurnState,
  deriveConversationMessages,
  deriveLastTurnSummary,
  deriveConversationStatusLabel,
  deriveInlineFeedState,
  deriveToolMessages,
  deriveVisibleMessages,
  getLatestAssistantMessage,
  getLatestToolMessage,
  getLatestUserMessage,
} from './presentation';
import { createPlatformAuthHandler } from './oauth';
import { createBrowserAppAgentPlatform, resolveStoreValue } from './platform';

type Listener = () => void;

type ApprovalResolver = {
  resolve: (value: { approved: boolean }) => void;
};

type InputResolver = {
  resolve: (value: { submitted: boolean; values?: Record<string, unknown> }) => void;
};

type AppAgentInternalState = {
  runtime: {
    agentConfig: AgentConfigResponse | null;
  };
  conversation: {
    id: string | null;
    messages: ChatMessage[];
    streamingContent: string;
    pendingTurn: ReturnType<typeof createInlinePendingTurnState> | null;
    pendingTurnSawActivity: boolean;
    statusLabel: string;
    resumeKey: string | null;
    isReady: boolean;
    isLoading: boolean;
    isLoadingHistory: boolean;
    isThinking: boolean;
    hasOlderMessages: boolean;
    error: SseError | null;
    issue: AppAgentIssue | null;
  };
  connections: {
    items: AppAgentConnection[];
  };
  approvals: {
    pending: AppAgentApproval[];
  };
  requests: {
    pending: AppAgentInputRequest[];
  };
  feedback: AppAgentFeedbackState;
};

export type AppAgentSnapshot = AppAgentSnapshotBase & {
  runtime: AppAgentSnapshotBase['runtime'] & {
    agent: EmcyAgent;
  };
  conversation: AppAgentSnapshotBase['conversation'] & {
    visibleMessages: ReturnType<typeof deriveVisibleMessages>;
    conversationMessages: ReturnType<typeof deriveConversationMessages>;
    toolMessages: ReturnType<typeof deriveToolMessages>;
    renderedNodes: ReturnType<typeof buildRenderedNodes>;
    latestAssistantMessage: ReturnType<typeof getLatestAssistantMessage>;
    latestToolMessage: ReturnType<typeof getLatestToolMessage>;
    latestUserMessage: ReturnType<typeof getLatestUserMessage>;
    lastTurn: ReturnType<typeof deriveLastTurnSummary>;
    pendingTurn: ReturnType<typeof createInlinePendingTurnState> | null;
    inlineFeed: ReturnType<typeof deriveInlineFeedState>;
  };
};

function createId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function normalizeSteps(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
}

function normalizeInputFields(value: unknown): AppAgentInputField[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry): AppAgentInputField[] => {
    if (!entry || typeof entry !== 'object') {
      return [];
    }

    const record = entry as Record<string, unknown>;
    const key = typeof record.key === 'string' ? record.key.trim() : '';
    const label = typeof record.label === 'string' ? record.label.trim() : '';
    const kind = typeof record.kind === 'string' ? record.kind : 'text';
    if (!key || !label) {
      return [];
    }

    return [{
      key,
      label,
      kind:
        kind === 'textarea'
        || kind === 'number'
        || kind === 'select'
        || kind === 'boolean'
          ? kind
          : 'text',
      required: Boolean(record.required),
      placeholder: typeof record.placeholder === 'string' ? record.placeholder : undefined,
      options: Array.isArray(record.options)
        ? record.options.flatMap((option) => {
            if (!option || typeof option !== 'object') {
              return [];
            }

            const optionRecord = option as Record<string, unknown>;
            const optionLabel = typeof optionRecord.label === 'string' ? optionRecord.label.trim() : '';
            const optionValue = typeof optionRecord.value === 'string' ? optionRecord.value : '';
            return optionLabel && optionValue
              ? [{ label: optionLabel, value: optionValue }]
              : [];
          })
        : undefined,
    }];
  });
}

function isToolRoutingResetError(error: SseError): boolean {
  return error.code === 'tool_routing_error'
    && /tool not found/i.test(error.message);
}

function mapConnections(agent: EmcyAgent): AppAgentConnection[] {
  return agent.getMcpServers().map((server) => ({
    url: server.url,
    name: server.name,
    authStatus: server.authStatus,
    canSignOut: server.canSignOut,
  }));
}

export class AppAgentController {
  private readonly listeners = new Set<Listener>();
  private readonly agent: EmcyAgent;
  private readonly platform: NonNullable<AppAgentConfig['platform']>;
  private readonly recoveredConversationIds = new Set<string>();
  private readonly approvalResolvers = new Map<string, ApprovalResolver>();
  private readonly inputResolvers = new Map<string, InputResolver>();
  private readonly pendingToolCallsByAction = new Map<string, string[]>();
  private readonly lifecycleUnsubscribers: Array<() => void> = [];
  private readonly userMessageDisplayOverrides = new Map<string, string>();
  private state: AppAgentInternalState;
  private snapshot: AppAgentSnapshot;
  private started = false;
  private disposed = false;
  private pendingDisplayText: string | null = null;

  constructor(private config: AppAgentConfig) {
    this.platform = config.platform ?? createBrowserAppAgentPlatform();

    const onAuthRequired =
      config.onAuthRequired
      ?? (
        this.platform.auth
          ? createPlatformAuthHandler({
              platform: this.platform,
              userIdentity: config.userIdentity,
              oauthCallbackUrl: config.oauthCallbackUrl ?? '',
            })
          : undefined
      );

    this.agent = new EmcyAgent({
      apiKey: config.apiKey,
      agentId: config.agentId,
      agentServiceUrl: config.serviceUrl,
      oauthCallbackUrl: config.oauthCallbackUrl,
      oauthClientMetadataUrl: config.oauthClientMetadataUrl,
      getAuthToken: config.getAuthToken,
      authSessionKey: config.appSessionKey,
      embeddedAuth: config.userIdentity
        ? {
            hostIdentity: config.userIdentity,
            mismatchPolicy: 'block_with_switch',
          }
        : undefined,
      useCookies: config.useCookies,
      onAuthRequired,
      externalUserId: config.externalUserId ?? config.userIdentity?.subject,
      context: config.appContext,
      clientTools: this.buildClientTools(config.clientTools),
      conversationHistoryPageSize: config.conversation?.historyPageSize ?? 50,
      storage: config.storage,
    });

    this.state = {
      runtime: {
        agentConfig: null,
      },
      conversation: {
        id: null,
        messages: [],
        streamingContent: '',
        pendingTurn: null,
        pendingTurnSawActivity: false,
        statusLabel: 'Connecting…',
        resumeKey: this.getResumeStorageKey(),
        isReady: false,
        isLoading: false,
        isLoadingHistory: false,
        isThinking: false,
        hasOlderMessages: false,
        error: null,
        issue: null,
      },
      connections: {
        items: [],
      },
      approvals: {
        pending: [],
      },
      requests: {
        pending: [],
      },
      feedback: {
        isSubmitting: false,
        error: null,
        lastSubmittedAt: null,
        lastFeedback: null,
      },
    };

    this.recomputeDerivedState();
    this.snapshot = this.buildSnapshot();
  }

  getAgent(): EmcyAgent {
    return this.agent;
  }

  getSnapshot = (): AppAgentSnapshot => this.snapshot;

  private buildSnapshot(): AppAgentSnapshot {
    const messages = applyUserMessageOverrides(
      this.state.conversation.messages,
      Object.fromEntries(this.userMessageDisplayOverrides),
    );
    const visibleMessages = deriveVisibleMessages(messages);
    const conversationMessages = deriveConversationMessages(messages);
    const toolMessages = deriveToolMessages(visibleMessages);
    const latestAssistantMessage = getLatestAssistantMessage(visibleMessages);
    const latestToolMessage = getLatestToolMessage(toolMessages);
    const latestUserMessage = getLatestUserMessage(visibleMessages);
    const lastTurn = deriveLastTurnSummary(messages);
    const renderedNodes = buildRenderedNodes(messages);
    const inlineFeed = deriveInlineFeedState({
      pendingTurn: this.state.conversation.pendingTurn,
      toolMessages,
      latestAssistantMessage: latestAssistantMessage
        ? { id: latestAssistantMessage.id, content: latestAssistantMessage.content }
        : null,
      streamingContent: this.state.conversation.streamingContent,
      isLoading: this.state.conversation.isLoading,
      isThinking: this.state.conversation.isThinking,
    });

    return {
      runtime: {
        agent: this.agent,
        agentConfig: this.state.runtime.agentConfig,
      },
      conversation: {
        ...this.state.conversation,
        messages,
        visibleMessages,
        conversationMessages,
        toolMessages,
        renderedNodes,
        latestAssistantMessage,
        latestToolMessage,
        latestUserMessage,
        lastTurn,
        pendingTurn: this.state.conversation.pendingTurn,
        inlineFeed,
      },
      connections: {
        ...this.state.connections,
        needsAttention: this.state.connections.items.some((item) => item.authStatus === 'needs_auth'),
      },
      approvals: {
        pending: this.state.approvals.pending,
      },
      requests: {
        pending: this.state.requests.pending,
      },
      feedback: this.state.feedback,
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  start(): void {
    if (this.started || this.disposed) {
      return;
    }

    this.started = true;
    this.bindLifecycleSignals();
    this.bindRuntimeEvents();
    void this.initialize();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.started = false;
    this.agent.off('message', this.handleMessage);
    this.agent.off('content_delta', this.handleContentDelta);
    this.agent.off('tool_call', this.handleToolCall);
    this.agent.off('tool_result', this.handleToolResult);
    this.agent.off('tool_error', this.handleToolError);
    this.agent.off('thinking', this.handleThinking);
    this.agent.off('loading', this.handleLoading);
    this.agent.off('error', this.handleError);
    this.agent.off('mcp_auth_status', this.handleMcpAuthStatus);
    this.lifecycleUnsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
    this.agent.cancel();
    this.approvalResolvers.clear();
    this.inputResolvers.clear();
    this.listeners.clear();
  }

  updateDynamicConfig(config: Pick<AppAgentConfig, 'appContext' | 'clientTools' | 'feedbackSource'>): void {
    this.config = {
      ...this.config,
      ...config,
    };
    this.agent.setAppContext(this.config.appContext);
    this.agent.setClientTools(this.buildClientTools(this.config.clientTools));
  }

  setAuthRequiredHandler(
    onAuthRequired: ((mcpServerUrl: string, authConfig: McpServerAuthConfig) => Promise<OAuthTokenResponse | undefined>) | undefined,
  ): void {
    this.config = {
      ...this.config,
      onAuthRequired,
    };
    this.agent.setOnAuthRequired(onAuthRequired);
  }

  async send(prompt: string, options?: { displayText?: string }): Promise<void> {
    const trimmed = prompt.trim();
    if (!trimmed) {
      return;
    }

    const displayText = (options?.displayText ?? trimmed).trim() || trimmed;
    this.pendingDisplayText = displayText;
    this.setState((current) => ({
      ...current,
      conversation: {
        ...current.conversation,
        pendingTurn: createInlinePendingTurnState(displayText, current.conversation.messages),
        pendingTurnSawActivity: false,
        issue: null,
      },
    }));

    try {
      await this.agent.sendMessage(trimmed);
    } catch (error) {
      this.pendingDisplayText = null;
      const message = error instanceof Error ? error.message : 'Could not send message.';
      this.setState((current) => ({
        ...current,
        conversation: {
          ...current.conversation,
          pendingTurn: null,
          pendingTurnSawActivity: false,
          error: {
            code: 'send_message_error',
            message,
          },
          issue: {
            code: 'runtime_error',
            message,
            recoverable: false,
          },
        },
      }));
      throw error;
    }
  }

  cancel(): void {
    this.agent.cancel();
  }

  async loadMore(): Promise<void> {
    this.setState((current) => ({
      ...current,
      conversation: {
        ...current.conversation,
        isLoadingHistory: true,
      },
    }));

    try {
      const page = await this.agent.loadOlderMessages();
      if (!page) {
        return;
      }

      this.syncFromRuntime();
    } finally {
      this.setState((current) => ({
        ...current,
        conversation: {
          ...current.conversation,
          isLoadingHistory: false,
        },
      }));
    }
  }

  async resetConversation(): Promise<void> {
    this.agent.newConversation();
    await this.clearResumeRecord();
    this.recoveredConversationIds.clear();
    this.pendingToolCallsByAction.clear();
    this.approvalResolvers.clear();
    this.inputResolvers.clear();
    this.userMessageDisplayOverrides.clear();
    this.pendingDisplayText = null;
    this.setState((current) => ({
      ...current,
      conversation: {
        ...current.conversation,
        id: null,
        messages: [],
        streamingContent: '',
        pendingTurn: null,
        pendingTurnSawActivity: false,
        hasOlderMessages: false,
        error: null,
        issue: null,
      },
      approvals: {
        pending: [],
      },
      requests: {
        pending: [],
      },
    }));
  }

  async connect(serverUrl: string): Promise<boolean> {
    const result = await this.agent.authenticate(serverUrl);
    this.setState((current) => ({
      ...current,
      connections: {
        items: mapConnections(this.agent),
      },
    }));
    return result;
  }

  async disconnect(serverUrl: string): Promise<void> {
    await this.agent.signOutMcpServer(serverUrl);
    this.setState((current) => ({
      ...current,
      connections: {
        items: mapConnections(this.agent),
      },
    }));
  }

  async submitFeedback(
    input: Omit<SubmitConversationFeedbackRequest, 'source'>,
  ): Promise<ConversationFeedback> {
    this.setState((current) => ({
      ...current,
      feedback: {
        ...current.feedback,
        isSubmitting: true,
        error: null,
      },
    }));

    try {
      const feedback = await this.agent.submitFeedback({
        ...input,
        source: this.config.feedbackSource ?? 'app-agent',
      });

      this.setState((current) => ({
        ...current,
        feedback: {
          isSubmitting: false,
          error: null,
          lastSubmittedAt: feedback.createdAt,
          lastFeedback: feedback,
        },
      }));
      return feedback;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not save feedback.';
      this.setState((current) => ({
        ...current,
        feedback: {
          ...current.feedback,
          isSubmitting: false,
          error: message,
        },
      }));
      throw error;
    }
  }

  resolveApproval(id: string, approved: boolean): void {
    const resolver = this.approvalResolvers.get(id);
    if (!resolver) {
      return;
    }

    this.approvalResolvers.delete(id);
    this.setState((current) => ({
      ...current,
      approvals: {
        pending: current.approvals.pending.filter((approval) => approval.id !== id),
      },
    }));
    resolver.resolve({ approved });
  }

  submitRequest(id: string, values?: Record<string, unknown>): void {
    const resolver = this.inputResolvers.get(id);
    if (!resolver) {
      return;
    }

    this.inputResolvers.delete(id);
    this.setState((current) => ({
      ...current,
      requests: {
        pending: current.requests.pending.filter((request) => request.id !== id),
      },
    }));
    resolver.resolve({ submitted: true, values });
  }

  cancelRequest(id: string): void {
    const resolver = this.inputResolvers.get(id);
    if (!resolver) {
      return;
    }

    this.inputResolvers.delete(id);
    this.setState((current) => ({
      ...current,
      requests: {
        pending: current.requests.pending.filter((request) => request.id !== id),
      },
    }));
    resolver.resolve({ submitted: false });
  }

  private async initialize(): Promise<void> {
    try {
      const agentConfig = await this.agent.init();
      if (this.disposed) {
        return;
      }

      this.setState((current) => ({
        ...current,
        runtime: {
          agentConfig,
        },
        conversation: {
          ...current.conversation,
          isReady: true,
        },
        connections: {
          items: mapConnections(this.agent),
        },
      }));

      const resumeRecord = await this.readResumeRecord();
      if (
        resumeRecord
        && resumeRecord.agentId === this.config.agentId
        && resumeRecord.appSessionKey === (this.config.appSessionKey ?? null)
        && resumeRecord.conversationResumeVersion === agentConfig.conversationResumeVersion
      ) {
        this.setState((current) => ({
          ...current,
          conversation: {
            ...current.conversation,
            isLoadingHistory: true,
          },
        }));

        try {
          await this.agent.loadConversation(
            resumeRecord.conversationId,
            this.config.conversation?.historyPageSize ?? 50,
          );
        } catch (error) {
          this.setState((current) => ({
            ...current,
            conversation: {
              ...current.conversation,
              error: {
                code: 'conversation_history_error',
                message: error instanceof Error ? error.message : 'Failed to load conversation history.',
              },
            },
          }));
          await this.clearResumeRecord();
        } finally {
          this.syncFromRuntime();
          this.setState((current) => ({
            ...current,
            conversation: {
              ...current.conversation,
              isLoadingHistory: false,
            },
          }));
        }
      } else {
        this.syncFromRuntime();
      }
    } catch (error) {
      const message = error instanceof Error && error.message.trim()
        ? error.message.trim()
        : 'Failed to load agent configuration.';
      this.setState((current) => ({
        ...current,
        conversation: {
          ...current.conversation,
          error: {
            code: /api key|unauthorized|401/i.test(message)
              ? 'agent_config_auth_error'
              : 'agent_config_error',
            message,
          },
          issue: {
            code: 'config_error',
            message,
            recoverable: false,
          },
        },
      }));
    }
  }

  private bindRuntimeEvents(): void {
    this.agent.on('message', this.handleMessage);
    this.agent.on('content_delta', this.handleContentDelta);
    this.agent.on('tool_call', this.handleToolCall);
    this.agent.on('tool_result', this.handleToolResult);
    this.agent.on('tool_error', this.handleToolError);
    this.agent.on('thinking', this.handleThinking);
    this.agent.on('loading', this.handleLoading);
    this.agent.on('error', this.handleError);
    this.agent.on('mcp_auth_status', this.handleMcpAuthStatus);
  }

  private readonly handleMessage = (message: ChatMessage): void => {
    if (message.role === 'user' && this.pendingDisplayText) {
      this.userMessageDisplayOverrides.set(message.id, this.pendingDisplayText);
      this.pendingDisplayText = null;
    }

    this.setState((current) => ({
      ...current,
      conversation: {
        ...current.conversation,
        messages: [...current.conversation.messages, message],
        id: this.agent.getConversationId(),
        streamingContent: '',
        hasOlderMessages: this.agent.getHasOlderMessages(),
        pendingTurnSawActivity: current.conversation.pendingTurn ? true : current.conversation.pendingTurnSawActivity,
      },
    }));
    void this.persistResumeRecord();
    this.finalizePendingTurnIfSettled();
  };

  private readonly handleContentDelta = (delta: SseContentDelta): void => {
    this.setState((current) => ({
      ...current,
      conversation: {
        ...current.conversation,
        streamingContent: current.conversation.streamingContent + delta.text,
        pendingTurnSawActivity: current.conversation.pendingTurn ? true : current.conversation.pendingTurnSawActivity,
      },
    }));
  };

  private readonly handleToolCall = (toolCall: SseToolCall): void => {
    if (
      toolCall.toolName === APP_AGENT_APPROVAL_ACTION
      || toolCall.toolName === APP_AGENT_INPUT_ACTION
    ) {
      const queue = this.pendingToolCallsByAction.get(toolCall.toolName) ?? [];
      queue.push(toolCall.toolCallId);
      this.pendingToolCallsByAction.set(toolCall.toolName, queue);
    }

    this.setState((current) => ({
      ...current,
      conversation: {
        ...current.conversation,
        id: this.agent.getConversationId(),
        messages: [
          ...current.conversation.messages,
          {
            id: crypto.randomUUID(),
            role: 'tool_call',
            content: `Calling ${toolCall.toolLabel ?? toolCall.toolName}...`,
            toolName: toolCall.toolName,
            toolLabel: toolCall.toolLabel,
            toolCallId: toolCall.toolCallId,
            timestamp: new Date(),
            toolCallStatus: 'calling',
            toolCallStartTime: Date.now(),
          },
        ],
        pendingTurnSawActivity: current.conversation.pendingTurn ? true : current.conversation.pendingTurnSawActivity,
      },
    }));
  };

  private readonly handleToolResult = (data: { toolCallId: string; result: unknown; duration: number }): void => {
    this.setState((current) => ({
      ...current,
      conversation: {
        ...current.conversation,
        messages: current.conversation.messages.map((message) =>
          message.role === 'tool_call' && message.toolCallId === data.toolCallId
            ? {
                ...message,
                toolCallStatus: 'completed',
                toolCallDuration: data.duration,
                toolResult:
                  typeof data.result === 'string'
                    ? data.result
                    : JSON.stringify(data.result),
              }
            : message,
        ),
      },
    }));
    this.finalizePendingTurnIfSettled();
  };

  private readonly handleToolError = (data: { toolCallId: string; error: string; duration: number }): void => {
    this.setState((current) => ({
      ...current,
      conversation: {
        ...current.conversation,
        messages: current.conversation.messages.map((message) =>
          message.role === 'tool_call' && message.toolCallId === data.toolCallId
            ? {
                ...message,
                toolCallStatus: 'error',
                toolCallDuration: data.duration,
                toolError: data.error,
              }
            : message,
        ),
      },
    }));
    this.finalizePendingTurnIfSettled();
  };

  private readonly handleThinking = (thinking: boolean): void => {
    this.setState((current) => ({
      ...current,
      conversation: {
        ...current.conversation,
        isThinking: thinking,
      },
    }));
    this.finalizePendingTurnIfSettled();
  };

  private readonly handleLoading = (loading: boolean): void => {
    this.setState((current) => ({
      ...current,
      conversation: {
        ...current.conversation,
        isLoading: loading,
        error: loading ? null : current.conversation.error,
        streamingContent: loading ? '' : current.conversation.streamingContent,
      },
    }));
    this.finalizePendingTurnIfSettled();
  };

  private readonly handleError = (error: SseError): void => {
    this.setState((current) => ({
      ...current,
      conversation: {
        ...current.conversation,
        error,
        pendingTurn: null,
        pendingTurnSawActivity: false,
      },
    }));

    if (isToolRoutingResetError(error)) {
      const conversationId = this.agent.getConversationId();
      if (conversationId && !this.recoveredConversationIds.has(conversationId)) {
        this.recoveredConversationIds.add(conversationId);
        void this.handleStaleConversation(error);
        return;
      }
    }

    this.setState((current) => ({
      ...current,
      conversation: {
        ...current.conversation,
        issue: {
          code: 'runtime_error',
          message: error.message,
          recoverable: false,
        },
      },
    }));
  };

  private readonly handleMcpAuthStatus = (): void => {
    this.setState((current) => ({
      ...current,
      connections: {
        items: mapConnections(this.agent),
      },
    }));
  };

  private async handleStaleConversation(error: SseError): Promise<void> {
    await this.clearResumeRecord();
    this.agent.newConversation();
    this.pendingToolCallsByAction.clear();
    this.approvalResolvers.clear();
    this.inputResolvers.clear();
    this.userMessageDisplayOverrides.clear();
    this.pendingDisplayText = null;
    this.setState((current) => ({
      ...current,
      conversation: {
        ...current.conversation,
        id: null,
        messages: [],
        streamingContent: '',
        pendingTurn: null,
        pendingTurnSawActivity: false,
        hasOlderMessages: false,
        issue: {
          code: 'stale_conversation',
          message: error.message,
          recoverable: true,
        },
      },
      approvals: {
        pending: [],
      },
      requests: {
        pending: [],
      },
    }));
  }

  private bindLifecycleSignals(): void {
    const lifecycle = this.platform.lifecycle;
    if (!lifecycle) {
      return;
    }

    const foregroundUnsubscribe = lifecycle.onForegroundChange?.(() => {
      this.emit();
    });
    if (foregroundUnsubscribe) {
      this.lifecycleUnsubscribers.push(foregroundUnsubscribe);
    }

    const connectivityUnsubscribe = lifecycle.onConnectivityChange?.(() => {
      this.emit();
    });
    if (connectivityUnsubscribe) {
      this.lifecycleUnsubscribers.push(connectivityUnsubscribe);
    }
  }

  private buildClientTools(clientTools: AppAgentConfig['clientTools']) {
    const approvalAction = {
      description: 'Ask the host app to approve a multi-step plan before you continue.',
      parameters: {
        title: { type: 'string', description: 'Short title for the approval request.', required: true },
        rationale: { type: 'string', description: 'Optional reason for the plan.' },
        steps: { type: 'array', description: 'Ordered steps that need approval.', required: true },
        confirmLabel: { type: 'string', description: 'Optional label for the approve action.' },
        cancelLabel: { type: 'string', description: 'Optional label for the reject action.' },
      },
      execute: async (params: Record<string, unknown>) => {
        const approvalId = createId('approval');
        const toolCallId = this.shiftPendingToolCallId(APP_AGENT_APPROVAL_ACTION);
        const approval: AppAgentApproval = {
          id: approvalId,
          title: typeof params.title === 'string' ? params.title : 'Approval required',
          rationale: typeof params.rationale === 'string' ? params.rationale : undefined,
          steps: normalizeSteps(params.steps),
          toolCallId,
          confirmLabel: typeof params.confirmLabel === 'string' ? params.confirmLabel : undefined,
          cancelLabel: typeof params.cancelLabel === 'string' ? params.cancelLabel : undefined,
        };

        this.setState((current) => ({
          ...current,
          approvals: {
            pending: [...current.approvals.pending, approval],
          },
        }));

        return await new Promise<{ approved: boolean }>((resolve) => {
          this.approvalResolvers.set(approvalId, { resolve });
        });
      },
    } satisfies NonNullable<AppAgentConfig['clientTools']>[string];

    return {
      ...(clientTools ?? {}),
      [APP_AGENT_APPROVAL_ACTION]: {
        ...approvalAction,
      },
      [APP_AGENT_INPUT_ACTION]: {
        description: 'Ask the host app for structured user input before you continue.',
        parameters: {
          title: { type: 'string', description: 'Short title for the input request.', required: true },
          prompt: { type: 'string', description: 'Optional explainer shown above the fields.' },
          fields: { type: 'array', description: 'Structured fields to collect.', required: true },
          submitLabel: { type: 'string', description: 'Optional submit button label.' },
          cancelLabel: { type: 'string', description: 'Optional cancel button label.' },
        },
        execute: async (params: Record<string, unknown>) => {
          const requestId = createId('input');
          const toolCallId = this.shiftPendingToolCallId(APP_AGENT_INPUT_ACTION);
          const request: AppAgentInputRequest = {
            id: requestId,
            title: typeof params.title === 'string' ? params.title : 'Input required',
            prompt: typeof params.prompt === 'string' ? params.prompt : undefined,
            fields: normalizeInputFields(params.fields),
            toolCallId,
            submitLabel: typeof params.submitLabel === 'string' ? params.submitLabel : undefined,
            cancelLabel: typeof params.cancelLabel === 'string' ? params.cancelLabel : undefined,
          };

          this.setState((current) => ({
            ...current,
            requests: {
              pending: [...current.requests.pending, request],
            },
          }));

          return await new Promise<{ submitted: boolean; values?: Record<string, unknown> }>((resolve) => {
            this.inputResolvers.set(requestId, { resolve });
          });
        },
      },
    };
  }

  private shiftPendingToolCallId(actionName: string): string | null {
    const queue = this.pendingToolCallsByAction.get(actionName) ?? [];
    const next = queue.shift() ?? null;
    if (queue.length === 0) {
      this.pendingToolCallsByAction.delete(actionName);
    } else {
      this.pendingToolCallsByAction.set(actionName, queue);
    }
    return next;
  }

  private syncFromRuntime(): void {
    this.setState((current) => ({
      ...current,
      conversation: {
        ...current.conversation,
        id: this.agent.getConversationId(),
        messages: this.agent.getMessages(),
        hasOlderMessages: this.agent.getHasOlderMessages(),
      },
      connections: {
        items: mapConnections(this.agent),
      },
    }));
    void this.persistResumeRecord();
  }

  private finalizePendingTurnIfSettled(): void {
    const current = this.state.conversation;
    if (
      current.pendingTurn
      && current.pendingTurnSawActivity
      && !current.isLoading
      && !current.isThinking
      && !current.streamingContent
    ) {
      this.setState((state) => ({
        ...state,
        conversation: {
          ...state.conversation,
          pendingTurn: null,
          pendingTurnSawActivity: false,
        },
      }));
    }
  }

  private getResumeStorageKey(): string | null {
    const durable = this.platform.storage?.durable;
    if (!durable) {
      return null;
    }

    const namespace = this.config.conversation?.namespace ?? 'emcy.app-agent.resume';
    const sessionKey = this.config.appSessionKey?.trim() || 'anonymous';
    return `${namespace}:${this.config.agentId}:${sessionKey}`;
  }

  private async readResumeRecord(): Promise<AppAgentConversationResumeRecord | null> {
    const durable = this.platform.storage?.durable;
    const resumeKey = this.getResumeStorageKey();
    if (!durable || !resumeKey) {
      return null;
    }

    try {
      const raw = await resolveStoreValue(durable.getItem(resumeKey));
      if (!raw) {
        return null;
      }

      return JSON.parse(raw) as AppAgentConversationResumeRecord;
    } catch {
      return null;
    }
  }

  private async persistResumeRecord(): Promise<void> {
    const durable = this.platform.storage?.durable;
    const resumeKey = this.getResumeStorageKey();
    const conversationId = this.agent.getConversationId();
    const agentConfig = this.state.runtime.agentConfig;
    if (!durable || !resumeKey || !conversationId || !agentConfig) {
      return;
    }

    const record: AppAgentConversationResumeRecord = {
      conversationId,
      agentId: this.config.agentId,
      appSessionKey: this.config.appSessionKey ?? null,
      conversationResumeVersion: agentConfig.conversationResumeVersion,
      updatedAt: new Date().toISOString(),
    };

    try {
      await resolveStoreValue(durable.setItem(resumeKey, JSON.stringify(record)));
    } catch {
      // Ignore persistence failures. Runtime state still works.
    }
  }

  private async clearResumeRecord(): Promise<void> {
    const durable = this.platform.storage?.durable;
    const resumeKey = this.getResumeStorageKey();
    if (!durable || !resumeKey) {
      return;
    }

    try {
      await resolveStoreValue(durable.removeItem(resumeKey));
    } catch {
      // Ignore persistence failures.
    }
  }

  private setState(update: (current: AppAgentInternalState) => AppAgentInternalState): void {
    if (this.disposed) {
      return;
    }

    this.state = update(this.state);
    this.recomputeDerivedState();
    this.snapshot = this.buildSnapshot();
    this.emit();
  }

  private recomputeDerivedState(): void {
    const hasAttention = this.state.connections.items.some((item) => item.authStatus === 'needs_auth');
    this.state.conversation.statusLabel = deriveConversationStatusLabel({
      isReady: this.state.conversation.isReady,
      isLoading: this.state.conversation.isLoading,
      isThinking: this.state.conversation.isThinking,
      streamingContent: this.state.conversation.streamingContent,
      hasError: this.state.conversation.error != null,
      hasIssue: this.state.conversation.issue != null,
      hasAttention,
    });
    this.state.conversation.resumeKey = this.getResumeStorageKey();
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export function createAppAgent(config: AppAgentConfig): AppAgentController {
  return new AppAgentController(config);
}
