import React, { useEffect, useRef, useState } from 'react';
import type { AppAgentConfig } from '../app/types';
import { AppAgentProvider, useAppAgentContext } from '../react-app';
import { ChatWindow } from './components/ChatWindow';
import { OAuthPopup } from './components/OAuthPopup';
import { WidgetButton } from './components/WidgetButton';

export interface EmcyChatProps extends AppAgentConfig {
  /**
   * Display mode:
   * - 'floating': chat popup with a fixed button (default)
   * - 'inline': embedded assistant that fills its container
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
  /** Called when a tool call completes or a turn settles after tool activity. */
  onToolActivity?: () => void;
}

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
    <AppAgentProvider {...agentConfig}>
      <EmcyChatInner
        mode={mode}
        title={title}
        welcomeMessage={welcomeMessage}
        placeholder={placeholder}
        defaultOpen={defaultOpen}
        onToolActivity={onToolActivity}
        hasUserIdentity={Boolean(agentConfig.userIdentity)}
      />
    </AppAgentProvider>
  );
}

interface EmcyChatInnerProps {
  mode: 'floating' | 'inline';
  title?: string;
  welcomeMessage?: string;
  placeholder?: string;
  defaultOpen: boolean;
  onToolActivity?: () => void;
  hasUserIdentity: boolean;
}

type AnimState = 'closed' | 'opening' | 'open' | 'closing';

function EmcyChatInner({
  mode,
  title,
  welcomeMessage,
  placeholder,
  defaultOpen,
  onToolActivity,
  hasUserIdentity,
}: EmcyChatInnerProps) {
  const [animState, setAnimState] = useState<AnimState>(defaultOpen ? 'open' : 'closed');
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wasLoadingRef = useRef(false);
  const prevSettledToolIdsRef = useRef<string[]>([]);
  const {
    runtime,
    conversation,
    composer,
    connections,
    popupAuthState,
    startOrRetryPopupAuth,
    cancelPopupAuth,
  } = useAppAgentContext();

  const widgetConfig = runtime.agentConfig?.widgetConfig;
  const resolvedTitle = title ?? widgetConfig?.title ?? 'AI Assistant';
  const resolvedWelcome = welcomeMessage ?? widgetConfig?.welcomeMessage;
  const resolvedPlaceholder = placeholder ?? widgetConfig?.placeholder;
  const mcpAuthButtonLabel = hasUserIdentity ? 'Start AI' : 'Needs Auth';

  useEffect(() => () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
  }, []);

  useEffect(() => {
    const settledToolIds = conversation.messages
      .filter(
        (message) =>
          message.role === 'tool_call'
          && (message.toolCallStatus === 'completed' || message.toolCallStatus === 'error')
          && Boolean(message.toolCallId),
      )
      .map((message) => message.toolCallId as string);

    if (
      wasLoadingRef.current
      && !conversation.isLoading
      && settledToolIds.length > prevSettledToolIdsRef.current.length
    ) {
      onToolActivity?.();
    }

    wasLoadingRef.current = conversation.isLoading;
    prevSettledToolIdsRef.current = settledToolIds;
  }, [conversation.isLoading, conversation.messages, onToolActivity]);

  const handleOpen = () => {
    setAnimState('opening');
    timerRef.current = setTimeout(() => setAnimState('open'), 300);
  };

  const handleClose = () => {
    setAnimState('closing');
    timerRef.current = setTimeout(() => setAnimState('closed'), 200);
  };

  const handleToggle = () => {
    if (animState === 'closed') {
      handleOpen();
      return;
    }

    if (animState === 'open') {
      handleClose();
    }
  };

  const handleMcpAuthClick = (serverUrl: string) => {
    void connections.connect(serverUrl);
  };

  const handleMcpSignOutClick = (serverUrl: string) => {
    void connections.disconnect(serverUrl);
  };

  const isOpen = animState === 'open' || animState === 'opening';
  const isVisible = animState !== 'closed';

  if (mode === 'inline') {
    return (
      <>
        <ChatWindow
          variant="inline"
          messages={conversation.messages}
          streamingContent={conversation.streamingContent}
          isLoading={conversation.isLoading}
          isLoadingHistory={conversation.isLoadingHistory}
          isThinking={conversation.isThinking}
          error={conversation.error}
          hasOlderMessages={conversation.hasOlderMessages}
          title={resolvedTitle}
          welcomeMessage={resolvedWelcome}
          placeholder={resolvedPlaceholder}
          mcpServers={connections.items}
          mcpAuthButtonLabel={mcpAuthButtonLabel}
          onSend={(message) => {
            void composer.send(message);
          }}
          onLoadOlderMessages={conversation.loadMore}
          onNewConversation={() => {
            void conversation.reset();
          }}
          onMcpAuthClick={handleMcpAuthClick}
          onMcpSignOutClick={handleMcpSignOutClick}
        />
        {popupAuthState ? (
          <OAuthPopup
            {...popupAuthState}
            onPrimaryAction={startOrRetryPopupAuth}
            onClose={cancelPopupAuth}
          />
        ) : null}
      </>
    );
  }

  return (
    <>
      {isVisible ? (
        <div
          className={
            animState === 'opening'
              ? 'emcy-fadeInScale'
              : animState === 'closing'
                ? 'emcy-fadeOut'
                : undefined
          }
          style={{ position: 'contents' as never }}
        >
          <ChatWindow
            messages={conversation.messages}
            streamingContent={conversation.streamingContent}
            isLoading={conversation.isLoading}
            isLoadingHistory={conversation.isLoadingHistory}
            isThinking={conversation.isThinking}
            error={conversation.error}
            hasOlderMessages={conversation.hasOlderMessages}
            title={resolvedTitle}
            welcomeMessage={resolvedWelcome}
            placeholder={resolvedPlaceholder}
            mcpServers={connections.items}
            mcpAuthButtonLabel={mcpAuthButtonLabel}
            onSend={(message) => {
              void composer.send(message);
            }}
            onLoadOlderMessages={conversation.loadMore}
            onClose={handleClose}
            onNewConversation={() => {
              void conversation.reset();
            }}
            onMcpAuthClick={handleMcpAuthClick}
            onMcpSignOutClick={handleMcpSignOutClick}
          />
          {popupAuthState ? (
            <OAuthPopup
              {...popupAuthState}
              onPrimaryAction={startOrRetryPopupAuth}
              onClose={cancelPopupAuth}
            />
          ) : null}
        </div>
      ) : null}

      {mode === 'floating' ? (
        <WidgetButton isOpen={isOpen} onClick={handleToggle} />
      ) : null}
    </>
  );
}
