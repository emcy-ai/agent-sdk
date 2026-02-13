import React, { useState, useEffect, useRef } from 'react';
import type { EmcyAgentConfig } from '../core/types';
import { EmcyChatProvider, useEmcyChatContext } from './EmcyChatProvider';
import { ChatWindow } from './components/ChatWindow';
import { WidgetButton } from './components/WidgetButton';

export interface EmcyChatProps extends EmcyAgentConfig {
  /** Display mode: 'floating' shows as a widget button, 'inline' renders directly */
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
 *   agentId="agent_xxxxx"
 *   getToken={async () => session.accessToken}
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
  const { messages, streamingContent, isLoading, isThinking, error, sendMessage, newConversation } =
    useEmcyChatContext();

  // Use widget config from agent if no explicit props
  const ctx = useEmcyChatContext();
  const widgetConfig = ctx.agentConfig?.widgetConfig;
  const resolvedTitle = title ?? widgetConfig?.title ?? 'AI Assistant';
  const resolvedWelcome = welcomeMessage ?? widgetConfig?.welcomeMessage;
  const resolvedPlaceholder = placeholder ?? widgetConfig?.placeholder;

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

  const isOpen = animState === 'open' || animState === 'opening';
  const isVisible = animState !== 'closed';

  if (mode === 'inline') {
    return (
      <ChatWindow
        messages={messages}
        streamingContent={streamingContent}
        isLoading={isLoading}
        isThinking={isThinking}
        error={error}
        title={resolvedTitle}
        welcomeMessage={resolvedWelcome}
        placeholder={resolvedPlaceholder}
        onSend={sendMessage}
        onNewConversation={newConversation}
      />
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
            onSend={sendMessage}
            onClose={handleClose}
            onNewConversation={newConversation}
          />
        </div>
      )}
      <WidgetButton isOpen={isOpen} onClick={handleToggle} />
    </>
  );
}
