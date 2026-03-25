import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildTokenCacheKey,
  resolveOAuthRegistration,
} from '../registration';
import type { McpServerAuthConfig } from '../../types';

describe('resolveOAuthRegistration', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('prefers an explicit preregistered client before CIMD or DCR', async () => {
    const fetchImpl = vi.fn();
    const authConfig: McpServerAuthConfig = {
      authType: 'oauth2',
      authorizationServerUrl: 'https://auth.todo.example.com',
      clientId: 'seeded-emcy-client',
      clientIdMetadataDocumentSupported: true,
      registrationEndpoint: 'https://auth.todo.example.com/connect/register',
    };

    const result = await resolveOAuthRegistration(authConfig, {
      callbackUrl: 'https://emcy.ai/oauth/callback',
      oauthClientMetadataUrl: 'https://emcy.ai/.well-known/oauth-client-metadata.json',
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(result.mode).toBe('preregistered');
    expect(result.clientId).toBe('seeded-emcy-client');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('uses CIMD when the auth server advertises client metadata documents', async () => {
    const authConfig: McpServerAuthConfig = {
      authType: 'oauth2',
      authorizationServerUrl: 'https://auth.todo.example.com',
      clientIdMetadataDocumentSupported: true,
    };

    const result = await resolveOAuthRegistration(authConfig, {
      callbackUrl: 'https://emcy.ai/oauth/callback',
      oauthClientMetadataUrl: 'https://emcy.ai/.well-known/oauth-client-metadata.json',
    });

    expect(result.mode).toBe('cimd');
    expect(result.clientId).toBe('https://emcy.ai/.well-known/oauth-client-metadata.json');
  });

  it('registers a public PKCE client via DCR and reuses the cached registration', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ client_id: 'dcr-client-123' }),
        {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );

    const authConfig: McpServerAuthConfig = {
      authType: 'oauth2',
      authorizationServerUrl: 'https://auth.todo.example.com',
      authorizationServerMetadataUrl:
        'https://auth.todo.example.com/.well-known/oauth-authorization-server',
      registrationEndpoint: 'https://auth.todo.example.com/connect/register',
      scopes: ['openid', 'todos.read'],
      resource: 'https://todo.example.com/mcp',
    };

    const first = await resolveOAuthRegistration(authConfig, {
      callbackUrl: 'https://emcy.ai/oauth/callback',
      clientName: 'Emcy MCP Client',
      fetchImpl: fetchImpl as typeof fetch,
    });
    const second = await resolveOAuthRegistration(authConfig, {
      callbackUrl: 'https://emcy.ai/oauth/callback',
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(first.mode).toBe('dcr');
    expect(first.clientId).toBe('dcr-client-123');
    expect(second.mode).toBe('dcr');
    expect(second.clientId).toBe('dcr-client-123');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('falls back to manual when no prereg, CIMD, or DCR path is available', async () => {
    const authConfig: McpServerAuthConfig = {
      authType: 'oauth2',
      authorizationServerUrl: 'https://auth.todo.example.com',
      registrationPreference: 'manual',
    };

    const result = await resolveOAuthRegistration(authConfig, {
      callbackUrl: 'https://emcy.ai/oauth/callback',
    });

    expect(result.mode).toBe('manual');
    expect(result.clientId).toBeUndefined();
  });
});

describe('buildTokenCacheKey', () => {
  it('includes resource and client mode in the token cache key', () => {
    const baseAuthConfig: McpServerAuthConfig = {
      authType: 'oauth2',
      authorizationServerUrl: 'https://auth.todo.example.com',
      callbackUrl: 'https://emcy.ai/oauth/callback',
      resource: 'https://todo.example.com/mcp',
      clientMode: 'cimd',
    };

    const differentResource = buildTokenCacheKey(
      { ...baseAuthConfig, resource: 'https://todo.example.com/admin-mcp' },
      'https://todo.example.com/mcp',
    );
    const differentMode = buildTokenCacheKey(
      { ...baseAuthConfig, clientMode: 'dcr' },
      'https://todo.example.com/mcp',
    );
    const original = buildTokenCacheKey(baseAuthConfig, 'https://todo.example.com/mcp');

    expect(differentResource).not.toBe(original);
    expect(differentMode).not.toBe(original);
  });
});
