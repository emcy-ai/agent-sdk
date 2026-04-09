import React, { forwardRef, useImperativeHandle } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { McpServerAuthConfig, OAuthTokenResponse } from '../../core/types';
import { usePopupOAuthController } from '../usePopupOAuthController';

type HarnessHandle = {
  requestAuth: (
    serverUrl: string,
    authConfig: McpServerAuthConfig,
  ) => Promise<OAuthTokenResponse | undefined>;
  handleServerAuthStatus: (
    serverUrl: string,
    authStatus: 'connected' | 'needs_auth',
  ) => void;
};

const SERVER_URL = 'https://todo.example.com/mcp';
const AUTH_CONFIG: McpServerAuthConfig = {
  authType: 'oauth2',
  authorizationEndpoint: 'https://todo.example.com/authorize',
  tokenEndpoint: 'https://todo.example.com/token',
  clientId: 'todo-client',
};

const ControllerHarness = forwardRef<HarnessHandle, { authSessionKey?: string | null }>((props, ref) => {
  const controller = usePopupOAuthController({
    resolveServerName: () => 'Todo MCP',
    oauthCallbackUrl: 'http://localhost:3000/oauth/callback',
    oauthClientMetadataUrl: 'http://localhost:3000/.well-known/oauth-client-metadata.json',
    authSessionKey: props.authSessionKey,
    embeddedAuth: {
      hostIdentity: { email: 'alex@todo.local' },
      mismatchPolicy: 'block_with_switch',
    },
  });

  useImperativeHandle(ref, () => ({
    requestAuth: controller.requestAuth,
    handleServerAuthStatus: controller.handleServerAuthStatus,
  }), [controller.handleServerAuthStatus, controller.requestAuth]);

  return <div>{controller.popupState?.phase ?? 'idle'}</div>;
});

ControllerHarness.displayName = 'ControllerHarness';

describe('usePopupOAuthController', () => {
  afterEach(() => {
    cleanup();
  });

  it('dismisses a stale popup prompt once the same MCP server reports connected', async () => {
    const ref = React.createRef<HarnessHandle>();

    render(<ControllerHarness ref={ref} />);

    await act(async () => {
      ref.current?.requestAuth(SERVER_URL, AUTH_CONFIG);
    });

    expect(screen.getByText('prompt')).toBeDefined();

    act(() => {
      ref.current?.handleServerAuthStatus(SERVER_URL, 'connected');
    });

    expect(screen.getByText('idle')).toBeDefined();
  });

  it('cancels an in-flight popup request when the authSessionKey changes', async () => {
    const ref = React.createRef<HarnessHandle>();
    const { rerender } = render(<ControllerHarness ref={ref} authSessionKey="session-a" />);

    let pendingRequest: Promise<OAuthTokenResponse | undefined> | undefined;
    await act(async () => {
      pendingRequest = ref.current?.requestAuth(SERVER_URL, AUTH_CONFIG);
    });

    expect(screen.getByText('prompt')).toBeDefined();

    rerender(<ControllerHarness ref={ref} authSessionKey="session-b" />);

    await expect(pendingRequest).resolves.toBeUndefined();
    expect(screen.getByText('idle')).toBeDefined();
  });
});
