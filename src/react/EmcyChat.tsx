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
}

/**
 * Drop-in React chat widget. Handles all agent communication internally.
 *
 * @example
 * ```tsx
 * <EmcyChat
 *   apiKey="emcy_sk_xxxx_yyyy"
 *   agentId="ws_xxxxx"
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
}

type AnimState = 'closed' | 'opening' | 'open' | 'closing';

function EmcyChatInner({
  mode,
  title,
  welcomeMessage,
  placeholder,
  defaultOpen,
}: EmcyChatInnerProps) {
  const [animState, setAnimState] = useState<AnimState>(defaultOpen ? 'open' : 'closed');
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
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
