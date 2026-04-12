import React, { forwardRef, useImperativeHandle } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  startOrRetryPopupAuth: () => void;
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
    startOrRetryPopupAuth: controller.startOrRetryPopupAuth,
  }), [controller.handleServerAuthStatus, controller.requestAuth, controller.startOrRetryPopupAuth]);

  return <div>{controller.popupState?.phase ?? 'idle'}</div>;
});

ControllerHarness.displayName = 'ControllerHarness';

describe('usePopupOAuthController', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
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

  it('opens the auth popup before async OAuth preparation finishes', async () => {
    const ref = React.createRef<HarnessHandle>();
    const popupWindow = {
      closed: false,
      close: vi.fn(),
      focus: vi.fn(),
      location: { replace: vi.fn() },
    } as unknown as Window;
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(popupWindow);

    let resolveDigest: ((value: ArrayBuffer) => void) | null = null;
    const digestPromise = new Promise<ArrayBuffer>((resolve) => {
      resolveDigest = resolve;
    });
    vi.spyOn(crypto.subtle, 'digest').mockReturnValue(digestPromise);

    render(<ControllerHarness ref={ref} />);

    await act(async () => {
      ref.current?.requestAuth(SERVER_URL, AUTH_CONFIG);
    });

    act(() => {
      ref.current?.startOrRetryPopupAuth();
    });

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith(
      'about:blank',
      'emcy-auth-popup',
      expect.stringContaining('popup=yes'),
    );
    expect((popupWindow as Window).name).toContain('emcy-auth:');
    expect(screen.getByText('preparing')).toBeDefined();
    expect(popupWindow.location.replace).not.toHaveBeenCalled();

    await act(async () => {
      resolveDigest?.(new ArrayBuffer(32));
      await digestPromise;
    });

    expect(popupWindow.location.replace).toHaveBeenCalledTimes(1);
  });
});
