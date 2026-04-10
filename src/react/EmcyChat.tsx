import React, { useState, useEffect, useRef } from 'react';
import type { EmcyAgentConfig } from '../core/types';
import { EmcyChatProvider, useEmcyChatContext } from './EmcyChatProvider';
import { ChatWindow } from './components/ChatWindow';
import { WidgetButton } from './components/WidgetButton';
import { OAuthPopup } from './components/OAuthPopup';

export interface EmcyChatProps extends EmcyAgentConfig {
  /**
   * Display mode:
   * - 'floating': Chatbot popup — fixed button in corner, opens as overlay (default)
   * - 'inline': Full-window embedded — responsive, fills its container. Parent needs defined dimensions.
   */
  mode?: 'floating' | 'inline';
  /** Chat window title */
  title?: string;
  /** Welcome message shown when no messages exist */
  welcomeMessage?: string;
  /** Input placeholder text */
  placeholder?: string;
  /** Whether the widget starts open (floating mode only) */
  defaultOpen?: boolean;
  /** Called when a tool call completes or the agent finishes a turn that included tool calls. Use this to refresh host app data. */
  onToolActivity?: () => void;
}

/**
 * Drop-in React chat widget. Handles all agent communication internally.
 *
 * @example
 * ```tsx
 * <EmcyChat
 *   apiKey="emcy_sk_xxxx_yyyy"
 *   agentId="ag_xxxxx"
 *   embeddedAuth={{
 *     hostIdentity: { email: session.user.email ?? undefined, subject: session.user.id },
 *     mismatchPolicy: 'block_with_switch',
 *   }}
 *   title="AI Assistant"
 * />
 * ```
 */
export function EmcyChat({
  mode = 'floating',
  title,
  welcomeMessage,
  placeholder,
  defaultOpen = false,
  onToolActivity,
  ...agentConfig
}: EmcyChatProps) {
  return (
    <EmcyChatProvider {...agentConfig}>
      <EmcyChatInner
        mode={mode}
        title={title}
        welcomeMessage={welcomeMessage}
        placeholder={placeholder}
        defaultOpen={defaultOpen}
        onToolActivity={onToolActivity}
      />
    </EmcyChatProvider>
  );
}

interface EmcyChatInnerProps {
  mode: 'floating' | 'inline';
  title?: string;
  welcomeMessage?: string;
  placeholder?: string;
  defaultOpen: boolean;
  onToolActivity?: () => void;
}

type AnimState = 'closed' | 'opening' | 'open' | 'closing';

function EmcyChatInner({
  mode,
  title,
  welcomeMessage,
  placeholder,
  defaultOpen,
  onToolActivity,
}: EmcyChatInnerProps) {
  const [animState, setAnimState] = useState<AnimState>(defaultOpen ? 'open' : 'closed');
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wasLoadingRef = useRef(false);
  const prevToolCountRef = useRef(0);
  const {
    agent,
    messages,
    streamingContent,
    isLoading,
    isThinking,
    error,
    sendMessage,
    signOutMcpServer,
    newConversation,
    mcpServers,
    agentConfig,
    popupAuthState,
    embeddedHostIdentity,
    startOrRetryPopupAuth,
    cancelPopupAuth,
  } =
    useEmcyChatContext();

  const widgetConfig = agentConfig?.widgetConfig;
  const resolvedTitle = title ?? widgetConfig?.title ?? 'AI Assistant';
  const resolvedWelcome = welcomeMessage ?? widgetConfig?.welcomeMessage;
  const resolvedPlaceholder = placeholder ?? widgetConfig?.placeholder;
  const mcpAuthButtonLabel = embeddedHostIdentity ? 'Start AI' : 'Needs Auth';

  // Cleanup timer on unmount
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  // Auto-fire onToolActivity when tool calls complete
  useEffect(() => {
    const toolMessages = messages.filter(m => m.role === 'tool_call');
    if (wasLoadingRef.current && !isLoading && toolMessages.length > 0) {
      onToolActivity?.();
    }
    wasLoadingRef.current = isLoading;
  }, [isLoading, messages, onToolActivity]);

  useEffect(() => {
    const toolMessages = messages.filter(m => m.role === 'tool_call');
    if (toolMessages.length > prevToolCountRef.current) {
      const latest = toolMessages[toolMessages.length - 1];
      if (latest.toolCallStatus === 'completed' || latest.toolCallStatus === 'error') {
        onToolActivity?.();
      }
    }
    prevToolCountRef.current = toolMessages.filter(m => m.role === 'tool_call').length;
  }, [messages, onToolActivity]);

  const handleOpen = () => {
    setAnimState('opening');
    timerRef.current = setTimeout(() => setAnimState('open'), 300);
  };

  const handleClose = () => {
    setAnimState('closing');
    timerRef.current = setTimeout(() => setAnimState('closed'), 200);
  };

  const handleToggle = () => {
    if (animState === 'closed') handleOpen();
    else if (animState === 'open') handleClose();
  };

  const handleMcpAuthClick = (serverUrl: string, _serverName: string) => {
    agent.authenticate(serverUrl).catch(() => {});
  };

  const handleMcpSignOutClick = (serverUrl: string, _serverName: string) => {
    signOutMcpServer(serverUrl).catch(() => {});
  };

  const isOpen = animState === 'open' || animState === 'opening';
  const isVisible = animState !== 'closed';

  if (mode === 'inline') {
    return (
      <>
        <ChatWindow
          variant="inline"
          messages={messages}
          streamingContent={streamingContent}
          isLoading={isLoading}
          isThinking={isThinking}
          error={error}
          title={resolvedTitle}
          welcomeMessage={resolvedWelcome}
          placeholder={resolvedPlaceholder}
          mcpServers={mcpServers}
          mcpAuthButtonLabel={mcpAuthButtonLabel}
          onSend={sendMessage}
          onNewConversation={newConversation}
          onMcpAuthClick={handleMcpAuthClick}
          onMcpSignOutClick={handleMcpSignOutClick}
        />
        {popupAuthState && (
          <OAuthPopup
            {...popupAuthState}
            onPrimaryAction={startOrRetryPopupAuth}
            onClose={cancelPopupAuth}
          />
        )}
      </>
    );
  }

  // Floating mode with open/close animation
  return (
    <>
      {isVisible && (
        <div
          className={animState === 'opening' ? 'emcy-fadeInScale' : animState === 'closing' ? 'emcy-fadeOut' : undefined}
          style={{ position: 'contents' as never }}
        >
          <ChatWindow
            messages={messages}
            streamingContent={streamingContent}
            isLoading={isLoading}
            isThinking={isThinking}
            error={error}
            title={resolvedTitle}
            welcomeMessage={resolvedWelcome}
            placeholder={resolvedPlaceholder}
            mcpServers={mcpServers}
            mcpAuthButtonLabel={mcpAuthButtonLabel}
            onSend={sendMessage}
            onClose={handleClose}
            onNewConversation={newConversation}
            onMcpAuthClick={handleMcpAuthClick}
            onMcpSignOutClick={handleMcpSignOutClick}
          />
        </div>
      )}
      {popupAuthState && (
        <OAuthPopup
          {...popupAuthState}
          onPrimaryAction={startOrRetryPopupAuth}
          onClose={cancelPopupAuth}
        />
      )}
      <WidgetButton isOpen={isOpen} onClick={handleToggle} />
    </>
  );
}
