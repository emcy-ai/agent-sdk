import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServerAuthConfig } from '../../../core/types';
import { OAuthPopup } from '../OAuthPopup';

describe('OAuthPopup', () => {
  const popupWindow = {
    closed: false,
    close: vi.fn(),
  } as unknown as Window;
  let openSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn());
    openSpy = vi.spyOn(window, 'open').mockReturnValue(popupWindow);
    vi.stubGlobal('setInterval', vi.fn(() => 1 as unknown as ReturnType<typeof setInterval>));
    vi.stubGlobal('clearInterval', vi.fn());
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('opens the authorize URL with a DCR-issued client_id and resource', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ client_id: 'dcr-client-123' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const authConfig: McpServerAuthConfig = {
      authType: 'oauth2',
      authorizationServerUrl: 'https://auth.todo.example.com',
      authorizationEndpoint: 'https://auth.todo.example.com/oauth/authorize',
      tokenEndpoint: 'https://auth.todo.example.com/oauth/token',
      registrationEndpoint: 'https://auth.todo.example.com/connect/register',
      resource: 'https://todo.example.com',
    };

    render(
      <OAuthPopup
        serverName="Todo MCP"
        serverUrl="https://todo.example.com"
        authConfig={authConfig}
        onToken={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        'https://auth.todo.example.com/connect/register',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    await waitFor(() => expect(openSpy).toHaveBeenCalled());
    const authUrl = openSpy.mock.calls[0]?.[0];
    expect(authUrl).toContain('client_id=dcr-client-123');
    expect(authUrl).toContain('resource=https%3A%2F%2Ftodo.example.com');
  });

  it('uses the provided Emcy-owned helper URLs instead of the host app origin', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ client_id: 'http://localhost:3100/.well-known/oauth-client-metadata.json' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const authConfig: McpServerAuthConfig = {
      authType: 'oauth2',
      authorizationServerUrl: 'https://auth.todo.example.com',
      authorizationEndpoint: 'https://auth.todo.example.com/oauth/authorize',
      tokenEndpoint: 'https://auth.todo.example.com/oauth/token',
      registrationEndpoint: 'https://auth.todo.example.com/connect/register',
      resource: 'https://todo.example.com',
    };

    render(
      <OAuthPopup
        serverName="Todo MCP"
        serverUrl="https://todo.example.com"
        authConfig={authConfig}
        oauthCallbackUrl="http://localhost:3100/oauth/callback"
        oauthClientMetadataUrl="http://localhost:3100/.well-known/oauth-client-metadata.json"
        onToken={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        'https://auth.todo.example.com/connect/register',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    const registrationCall = fetchMock.mock.calls[0];
    const registrationBody = JSON.parse(registrationCall?.[1]?.body as string);
    expect(registrationBody.redirect_uris).toEqual(['http://localhost:3100/oauth/callback']);

    await waitFor(() => expect(openSpy).toHaveBeenCalled());
    const authUrl = new URL(openSpy.mock.calls[0]?.[0] as string);
    expect(authUrl.searchParams.get('redirect_uri')).toBe('http://localhost:3100/oauth/callback');
    expect(authUrl.searchParams.get('client_id')).toBe(
      'http://localhost:3100/.well-known/oauth-client-metadata.json',
    );
  });

  it('exchanges the authorization code with resource and resolved auth config', async () => {
    const onToken = vi.fn();
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({
        access_token: 'access-token-123',
        refresh_token: 'refresh-token-123',
        expires_in: 3600,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const authConfig: McpServerAuthConfig = {
      authType: 'oauth2',
      authorizationEndpoint: 'https://auth.todo.example.com/oauth/authorize',
      tokenEndpoint: 'https://auth.todo.example.com/oauth/token',
      clientId: 'seeded-emcy-client',
      resource: 'https://todo.example.com',
      callbackUrl: 'https://emcy.ai/oauth/callback',
    };

    render(
      <OAuthPopup
        serverName="Todo MCP"
        serverUrl="https://todo.example.com"
        authConfig={authConfig}
        onToken={onToken}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => expect(openSpy).toHaveBeenCalled());
    const openedUrl = new URL(openSpy.mock.calls[0]?.[0] as string);
    const expectedState = openedUrl.searchParams.get('state');

    window.dispatchEvent(new MessageEvent('message', {
      origin: 'https://emcy.ai',
      data: {
        type: 'emcy-oauth-code',
        code: 'auth-code-123',
        state: expectedState,
      },
    }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      'https://auth.todo.example.com/oauth/token',
      expect.objectContaining({ method: 'POST' }),
    ));

    const tokenCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    const tokenBody = (tokenCall?.[1]?.body as URLSearchParams).toString();
    expect(tokenBody).toContain('client_id=seeded-emcy-client');
    expect(tokenBody).toContain('resource=https%3A%2F%2Ftodo.example.com');

    await waitFor(() => expect(onToken).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'access-token-123',
      refreshToken: 'refresh-token-123',
      resolvedAuthConfig: expect.objectContaining({
        clientId: 'seeded-emcy-client',
        resource: 'https://todo.example.com',
      }),
    })));
  });

  it('ignores popup callback messages with the wrong state', async () => {
    const onToken = vi.fn();

    const authConfig: McpServerAuthConfig = {
      authType: 'oauth2',
      authorizationEndpoint: 'https://auth.todo.example.com/oauth/authorize',
      callbackUrl: 'https://emcy.ai/oauth/callback',
    };

    render(
      <OAuthPopup
        serverName="Todo MCP"
        serverUrl="https://todo.example.com"
        authConfig={authConfig}
        onToken={onToken}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    await waitFor(() => expect(openSpy).toHaveBeenCalled());

    window.dispatchEvent(new MessageEvent('message', {
      origin: 'https://emcy.ai',
      data: {
        type: 'emcy-oauth-callback',
        token: 'should-not-be-used',
        state: 'wrong-state',
      },
    }));

    await waitFor(() => {
      expect(onToken).not.toHaveBeenCalled();
    });
  });
});
