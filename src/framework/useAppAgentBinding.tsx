import {
  useEffect,
  useMemo,
  useSyncExternalStore,
} from 'react';
import type { McpServerAuthConfig, OAuthTokenResponse, SubmitConversationFeedbackRequest } from '../core/types';
import { AppAgentController, type AppAgentSnapshot } from '../app/controller';
import type { AppAgentConfig } from '../app/types';

export interface OAuthPopupState {
  serverName: string;
  serverUrl: string;
  phase: 'prompt' | 'preparing' | 'waiting' | 'exchanging' | 'blocked' | 'canceled' | 'error';
  statusMessage?: string | null;
  errorMessage?: string | null;
  hostIdentityLabel?: string | null;
}

export interface UseAppAgentOptions {
  enabled?: boolean;
}

export interface UseAppAgentReturn {
  controller: AppAgentController;
  runtime: AppAgentSnapshot['runtime'];
  conversation: AppAgentSnapshot['conversation'] & {
    loadMore: () => Promise<void>;
    reset: () => Promise<void>;
  };
  composer: {
    send: (prompt: string, options?: { displayText?: string }) => Promise<void>;
    cancel: () => void;
  };
  connections: AppAgentSnapshot['connections'] & {
    connect: (serverUrl: string) => Promise<boolean>;
    disconnect: (serverUrl: string) => Promise<void>;
  };
  approvals: AppAgentSnapshot['approvals'] & {
    resolve: (id: string, approved: boolean) => void;
  };
  requests: AppAgentSnapshot['requests'] & {
    submit: (id: string, values?: Record<string, unknown>) => void;
    cancel: (id: string) => void;
  };
  feedback: AppAgentSnapshot['feedback'] & {
    submit: (input: Omit<SubmitConversationFeedbackRequest, 'source'>) => Promise<unknown>;
  };
  popupAuthState: OAuthPopupState | null;
  startOrRetryPopupAuth: () => void;
  cancelPopupAuth: () => void;
}

export function useAppAgentBinding(
  config: AppAgentConfig,
  options: UseAppAgentOptions | undefined,
  auth: {
    onAuthRequired?: (mcpServerUrl: string, authConfig: McpServerAuthConfig) => Promise<OAuthTokenResponse | undefined>;
    popupAuthState?: OAuthPopupState | null;
    startOrRetryPopupAuth?: () => void;
    cancelPopupAuth?: () => void;
  } = {},
): UseAppAgentReturn {
  const enabled = options?.enabled ?? true;

  const controller = useMemo(() => new AppAgentController({
    ...config,
    onAuthRequired: auth.onAuthRequired ?? config.onAuthRequired,
  }), [
    auth.onAuthRequired,
    config.agentId,
    config.apiKey,
    config.appSessionKey,
    config.conversation?.historyPageSize,
    config.conversation?.namespace,
    config.externalUserId,
    config.getAuthToken,
    config.oauthCallbackUrl,
    config.oauthClientMetadataUrl,
    config.onAuthRequired,
    config.platform,
    config.serviceUrl,
    config.storage,
    config.useCookies,
    config.userIdentity?.avatarUrl,
    config.userIdentity?.displayName,
    config.userIdentity?.email,
    config.userIdentity?.organizationId,
    config.userIdentity?.subject,
    enabled,
  ]);

  useEffect(() => () => {
    controller.dispose();
  }, [controller]);

  useEffect(() => {
    controller.updateDynamicConfig({
      appContext: config.appContext,
      hostActions: config.hostActions,
      feedbackSource: config.feedbackSource,
    });
  }, [config.appContext, config.feedbackSource, config.hostActions, controller]);

  useEffect(() => {
    controller.setAuthRequiredHandler(auth.onAuthRequired ?? config.onAuthRequired);
  }, [auth.onAuthRequired, config.onAuthRequired, controller]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    controller.start();
  }, [controller, enabled]);

  const snapshot = useSyncExternalStore(
    controller.subscribe.bind(controller),
    controller.getSnapshot,
    controller.getSnapshot,
  );

  return {
    controller,
    runtime: snapshot.runtime,
    conversation: {
      ...snapshot.conversation,
      loadMore: () => controller.loadMore(),
      reset: () => controller.resetConversation(),
    },
    composer: {
      send: (prompt, sendOptions) => controller.send(prompt, sendOptions),
      cancel: () => controller.cancel(),
    },
    connections: {
      ...snapshot.connections,
      connect: (serverUrl) => controller.connect(serverUrl),
      disconnect: (serverUrl) => controller.disconnect(serverUrl),
    },
    approvals: {
      ...snapshot.approvals,
      resolve: (id, approved) => controller.resolveApproval(id, approved),
    },
    requests: {
      ...snapshot.requests,
      submit: (id, values) => controller.submitRequest(id, values),
      cancel: (id) => controller.cancelRequest(id),
    },
    feedback: {
      ...snapshot.feedback,
      submit: (input) => controller.submitFeedback(input),
    },
    popupAuthState: auth.popupAuthState ?? null,
    startOrRetryPopupAuth: auth.startOrRetryPopupAuth ?? (() => undefined),
    cancelPopupAuth: auth.cancelPopupAuth ?? (() => undefined),
  };
}
