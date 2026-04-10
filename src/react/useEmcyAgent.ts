import { useEffect, useRef, useState } from 'react';
import { EmcyAgent } from '../core/EmcyAgent';
import {
  clearPersistedMcpAuthState,
  resolveExplicitAuthSessionKey,
} from '../core/auth-storage';
import type {
  EmcyAgentConfig,
  ChatMessage,
  AgentConfigResponse,
  SseContentDelta,
  SseToolCall,
  SseError,
  McpAuthStatusEvent,
} from '../core/types';
import type { McpServerStatus } from './components/McpServerStatusBar';

function toAgentConfigError(error: unknown): SseError {
  const message = error instanceof Error && error.message.trim()
    ? error.message.trim()
    : 'Failed to load agent configuration.';
  const isAuthError = /api key|unauthorized|401/i.test(message);

  return {
    code: isAuthError ? 'agent_config_auth_error' : 'agent_config_error',
    message,
  };
}

export interface UseEmcyAgentReturn {
  agent: EmcyAgent;
  conversationId: string | null;
  messages: ChatMessage[];
  isLoading: boolean;
  isThinking: boolean;
  error: SseError | null;
  agentConfig: AgentConfigResponse | null;
  mcpServers: McpServerStatus[];
  sendMessage: (message: string) => Promise<void>;
  authenticateMcpServer: (mcpServerUrl: string) => Promise<boolean>;
  signOutMcpServer: (mcpServerUrl: string) => Promise<void>;
  cancel: () => void;
  newConversation: () => void;
  streamingContent: string;
}

/**
 * React hook for programmatic use of EmcyAgent.
 * Use this when you want full control over the UI.
 */
export function useEmcyAgent(config: EmcyAgentConfig): UseEmcyAgentReturn {
  const latestConfigRef = useRef(config);
  latestConfigRef.current = config;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [error, setError] = useState<SseError | null>(null);
  const [agentConfig, setAgentConfig] = useState<AgentConfigResponse | null>(null);
  const [streamingContent, setStreamingContent] = useState('');
  const [mcpServers, setMcpServers] = useState<McpServerStatus[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const authSessionKey = resolveExplicitAuthSessionKey(config);
  const authSessionKeyRef = useRef(authSessionKey);

  const [agent, setAgent] = useState<EmcyAgent>(() => new EmcyAgent(latestConfigRef.current));
  const agentRef = useRef(agent);
  agentRef.current = agent;

  useEffect(() => {
    const previousAuthSessionKey = authSessionKeyRef.current;
    if (previousAuthSessionKey === authSessionKey) {
      return;
    }

    authSessionKeyRef.current = authSessionKey;
    agentRef.current.cancel();

    if (previousAuthSessionKey) {
      clearPersistedMcpAuthState({ authSessionKey: previousAuthSessionKey });
    }

    setConversationId(null);
    setMessages([]);
    setStreamingContent('');
    setError(null);
    setIsThinking(false);
    setIsLoading(false);
    setAgentConfig(null);
    setMcpServers([]);
    setAgent(new EmcyAgent(latestConfigRef.current));
  }, [authSessionKey]);

  useEffect(() => {
    let isCurrent = true;

    const onMessage = (msg: ChatMessage) => {
      setMessages((prev) => [...prev, msg]);
      setStreamingContent('');
      setConversationId(agent.getConversationId());
    };

    const onContentDelta = (delta: SseContentDelta) => {
      setStreamingContent((prev) => prev + delta.text);
    };

    const onToolCall = (tc: SseToolCall) => {
      setConversationId(agent.getConversationId());
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'tool_call' as const,
          content: `Calling ${tc.toolLabel ?? tc.toolName}...`,
          toolName: tc.toolName,
          toolLabel: tc.toolLabel,
          toolCallId: tc.toolCallId,
          timestamp: new Date(),
          toolCallStatus: 'calling' as const,
          toolCallStartTime: Date.now(),
        },
      ]);
    };

    const onToolResult = (data: { toolCallId: string; result: unknown; duration: number }) => {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.role === 'tool_call' && msg.toolCallId === data.toolCallId
            ? {
                ...msg,
                toolCallStatus: 'completed' as const,
                toolCallDuration: data.duration,
                toolResult:
                  typeof data.result === 'string'
                    ? data.result
                    : JSON.stringify(data.result),
              }
            : msg,
        ),
      );
    };

    const onToolError = (data: { toolCallId: string; error: string; duration: number }) => {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.role === 'tool_call' && msg.toolCallId === data.toolCallId
            ? {
                ...msg,
                toolCallStatus: 'error' as const,
                toolCallDuration: data.duration,
                toolError: data.error,
              }
            : msg,
        ),
      );
    };

    const onThinking = (thinking: boolean) => {
      setIsThinking(thinking);
    };

    const onLoading = (loading: boolean) => {
      setIsLoading(loading);
      if (loading) {
        setError(null);
        setStreamingContent('');
      }
    };

    const onError = (err: SseError) => {
      setError(err);
    };

    const onMcpAuthStatus = (_event: McpAuthStatusEvent) => {
      // Refresh MCP server statuses from the agent
      setMcpServers(agent.getMcpServers());
    };

    agent.on('message', onMessage);
    agent.on('content_delta', onContentDelta);
    agent.on('tool_call', onToolCall);
    agent.on('tool_result', onToolResult);
    agent.on('tool_error', onToolError);
    agent.on('thinking', onThinking);
    agent.on('loading', onLoading);
    agent.on('error', onError);
    agent.on('mcp_auth_status', onMcpAuthStatus);

    agent.init().then((config) => {
      if (!isCurrent) {
        return;
      }

      setAgentConfig(config);
      setMcpServers(agent.getMcpServers());
      setConversationId(agent.getConversationId());
    }).catch((err) => {
      if (!isCurrent) {
        return;
      }

      setError(toAgentConfigError(err));
    });

    return () => {
      isCurrent = false;
      agent.off('message', onMessage);
      agent.off('content_delta', onContentDelta);
      agent.off('tool_call', onToolCall);
      agent.off('tool_result', onToolResult);
      agent.off('tool_error', onToolError);
      agent.off('thinking', onThinking);
      agent.off('loading', onLoading);
      agent.off('error', onError);
      agent.off('mcp_auth_status', onMcpAuthStatus);
      agent.cancel();
    };
  }, [agent]);

  const sendMessage = async (message: string) => {
    await agent.sendMessage(message);
  };

  const signOutMcpServer = async (mcpServerUrl: string) => {
    await agent.signOutMcpServer(mcpServerUrl);
  };

  const authenticateMcpServer = async (mcpServerUrl: string) => {
    const success = await agent.authenticate(mcpServerUrl);
    setMcpServers(agent.getMcpServers());
    return success;
  };

  const cancel = () => {
    agent.cancel();
  };

  const newConversation = () => {
    agent.newConversation();
    setConversationId(null);
    setMessages([]);
    setStreamingContent('');
    setError(null);
    setIsThinking(false);
  };

  return {
    agent,
    conversationId,
    messages,
    isLoading,
    isThinking,
    error,
    agentConfig,
    mcpServers,
    sendMessage,
    authenticateMcpServer,
    signOutMcpServer,
    cancel,
    newConversation,
    streamingContent,
  };
}
