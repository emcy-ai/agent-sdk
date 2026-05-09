import React, { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import type { AppAgentConfig } from '../app/types';
import type { McpServerAuthConfig, OAuthTokenResponse } from '../core/types';
import {
  useAppAgentBinding,
  type OAuthPopupState,
  type UseAppAgentOptions,
  type UseAppAgentReturn,
} from '../framework/useAppAgentBinding';
import { usePopupOAuthController } from '../react/usePopupOAuthController';

const AppAgentContext = createContext<UseAppAgentReturn | null>(null);

export interface AppAgentProviderProps extends AppAgentConfig {
  children: React.ReactNode;
}

export function useAppAgent(
  config: AppAgentConfig,
  options?: UseAppAgentOptions,
): UseAppAgentReturn {
  const shouldUseBuiltInPopupAuth = !config.onAuthRequired;
  const popupRequestAuthRef = useRef<(
    serverUrl: string,
    authConfig: McpServerAuthConfig,
  ) => Promise<OAuthTokenResponse | undefined> | null>(null);
  const builtInPopupAuthHandler = useMemo(() => {
    const handler = (
      serverUrl: string,
      authConfig: McpServerAuthConfig,
    ) => popupRequestAuthRef.current?.(serverUrl, authConfig) ?? Promise.resolve(undefined);

    (handler as { __emcyBuiltinPopupAuth?: boolean }).__emcyBuiltinPopupAuth = true;
    return handler;
  }, []);

  const base = useAppAgentBinding(
    config,
    options,
    shouldUseBuiltInPopupAuth
      ? { onAuthRequired: builtInPopupAuthHandler }
      : undefined,
  );

  const popup = usePopupOAuthController({
    resolveServerName: (serverUrl: string) =>
      base.runtime.agentConfig?.mcpServers.find((server) => server.url === serverUrl)?.name
      ?? 'MCP Server',
    oauthCallbackUrl: base.runtime.agent.getOAuthCallbackUrl(),
    oauthClientMetadataUrl: base.runtime.agent.getOAuthClientMetadataUrl(),
    userIdentity: config.userIdentity,
    appSessionKey: config.appSessionKey,
  });

  popupRequestAuthRef.current = popup.requestAuth;

  useEffect(() => {
    if (!shouldUseBuiltInPopupAuth) {
      return;
    }

    base.controller.setAuthRequiredHandler(builtInPopupAuthHandler);
  }, [base.controller, builtInPopupAuthHandler, shouldUseBuiltInPopupAuth]);

  useEffect(() => {
    base.connections.items.forEach((server) => {
      popup.handleServerAuthStatus(server.url, server.authStatus);
    });
  }, [base.connections.items, popup.handleServerAuthStatus]);

  const visiblePopupState: OAuthPopupState | null = shouldUseBuiltInPopupAuth && popup.popupState
    ? (
      base.connections.items.find((server) => server.url === popup.popupState?.serverUrl)?.authStatus === 'connected'
        ? null
        : popup.popupState
    )
    : null;

  return {
    ...base,
    popupAuthState: visiblePopupState,
    startOrRetryPopupAuth: popup.startOrRetryPopupAuth,
    cancelPopupAuth: popup.cancelPopupAuth,
  };
}

export function AppAgentProvider({
  children,
  ...config
}: AppAgentProviderProps) {
  const value = useAppAgent(config);
  return (
    <AppAgentContext.Provider value={value}>
      {children}
    </AppAgentContext.Provider>
  );
}

export function useAppAgentContext(): UseAppAgentReturn {
  const context = useContext(AppAgentContext);
  if (!context) {
    throw new Error('useAppAgentContext must be used within an AppAgentProvider.');
  }

  return context;
}

export type {
  OAuthPopupState,
  UseAppAgentOptions,
  UseAppAgentReturn,
};
