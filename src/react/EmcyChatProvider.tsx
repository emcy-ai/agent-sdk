import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { EmcyAgent } from '../core/EmcyAgent';
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

export interface EmcyChatContextValue {
  agent: EmcyAgent;
  messages: ChatMessage[];
  isLoading: boolean;
  isThinking: boolean;
  error: SseError | null;
  agentConfig: AgentConfigResponse | null;
  mcpServers: McpServerStatus[];
  sendMessage: (message: string) => Promise<void>;
  cancel: () => void;
  newConversation: () => void;
  streamingContent: string;
}

const EmcyChatContext = createContext<EmcyChatContextValue | null>(null);

export interface EmcyChatProviderProps extends EmcyAgentConfig {
  children: React.ReactNode;
}

/**
 * Provides EmcyAgent instance and chat state to child components.
 * Handles initialization and event subscriptions.
 */
export function EmcyChatProvider({ children, ...config }: EmcyChatProviderProps) {
  const agentRef = useRef<EmcyAgent | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [error, setError] = useState<SseError | null>(null);
  const [agentConfig, setAgentConfig] = useState<AgentConfigResponse | null>(null);
  const [streamingContent, setStreamingContent] = useState('');
  const [mcpServers, setMcpServers] = useState<McpServerStatus[]>([]);

  // Create agent once
  if (!agentRef.current) {
    agentRef.current = new EmcyAgent(config);
  }
  const agent = agentRef.current;

  useEffect(() => {
    // Subscribe to events
    const onMessage = (msg: ChatMessage) => {
      setMessages((prev) => [...prev, msg]);
      setStreamingContent('');
    };

    const onContentDelta = (delta: SseContentDelta) => {
      setStreamingContent((prev) => prev + delta.text);
    };

    const onToolCall = (tc: SseToolCall) => {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'tool_call' as const,
          content: `Calling ${tc.toolName}...`,
          toolName: tc.toolName,
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

    // Initialize agent
    agent.init().then((config) => {
      setAgentConfig(config);
      setMcpServers(agent.getMcpServers());
    }).catch(() => {});

    return () => {
      agent.off('message', onMessage);
      agent.off('content_delta', onContentDelta);
      agent.off('tool_call', onToolCall);
      agent.off('tool_result', onToolResult);
      agent.off('tool_error', onToolError);
      agent.off('thinking', onThinking);
      agent.off('loading', onLoading);
      agent.off('error', onError);
      agent.off('mcp_auth_status', onMcpAuthStatus);
    };
  }, [agent]);

  const sendMessage = async (message: string) => {
    await agent.sendMessage(message);
  };

  const cancel = () => {
    agent.cancel();
  };

  const newConversation = () => {
    agent.newConversation();
    setMessages([]);
    setStreamingContent('');
    setError(null);
    setIsThinking(false);
  };

  return (
    <EmcyChatContext.Provider
      value={{
        agent,
        messages,
        isLoading,
        isThinking,
        error,
        agentConfig,
        mcpServers,
        sendMessage,
        cancel,
        newConversation,
        streamingContent,
      }}
    >
      {children}
    </EmcyChatContext.Provider>
  );
}

export function useEmcyChatContext(): EmcyChatContextValue {
  const ctx = useContext(EmcyChatContext);
  if (!ctx) {
    throw new Error('useEmcyChatContext must be used within an <EmcyChatProvider>');
  }
  return ctx;
}
