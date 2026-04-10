import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmcyAgent } from '../EmcyAgent';
import {
  applyResolvedRegistration,
  buildRegistrationCacheKey,
  loadStoredRegistration,
  saveStoredRegistration,
} from '../auth/registration';
import {
  clearPersistedMcpAuth,
  clearPersistedMcpAuthState,
} from '../auth-storage';
import type { AgentConfigResponse, McpServerAuthConfig, OAuthTokenResponse } from '../types';

const MCP_SERVER_URL = 'https://todo.example.com';

function createWorkspaceConfig(authConfig: McpServerAuthConfig): AgentConfigResponse {
  return {
    workspaceId: 'workspace_test',
    name: 'Auth Workspace',
    mcpServers: [
      {
        id: 'server_todo',
        name: 'Todo MCP',
        url: MCP_SERVER_URL,
        authStatus: 'needs_auth',
        authConfig,
      },
    ],
    widgetConfig: null,
  };
}

describe('EmcyAgent auth behavior', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('discovers protected-resource metadata, auth metadata, and registration capabilities during init', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url === 'https://api.emcy.ai/api/v1/workspaces/workspace_test/config') {
        return Response.json(createWorkspaceConfig({ authType: 'oauth2' }));
      }

      if (url === 'https://todo.example.com/.well-known/oauth-protected-resource') {
        return Response.json({
          resource: MCP_SERVER_URL,
          authorization_servers: ['https://auth.todo.example.com'],
          scopes_supported: ['openid', 'todos.read'],
        });
      }

      if (url === 'https://auth.todo.example.com/.well-known/oauth-authorization-server') {
        return Response.json({
          issuer: 'https://auth.todo.example.com',
          authorization_endpoint: 'https://auth.todo.example.com/oauth/authorize',
          token_endpoint: 'https://auth.todo.example.com/oauth/token',
          registration_endpoint: 'https://auth.todo.example.com/connect/register',
          client_id_metadata_document_supported: true,
          resource_parameter_supported: true,
          scopes_supported: ['openid', 'todos.read'],
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const agent = new EmcyAgent({
      apiKey: 'emcy-test-key',
      agentId: 'workspace_test',
    });

    await agent.init();

    const authConfig = agent.getServerAuthConfig(MCP_SERVER_URL);
    expect(authConfig?.authorizationServerUrl).toBe('https://auth.todo.example.com');
    expect(authConfig?.authorizationEndpoint).toBe('https://auth.todo.example.com/oauth/authorize');
    expect(authConfig?.tokenEndpoint).toBe('https://auth.todo.example.com/oauth/token');
    expect(authConfig?.registrationEndpoint).toBe('https://auth.todo.example.com/connect/register');
    expect(authConfig?.resource).toBe(MCP_SERVER_URL);
    expect(authConfig?.clientIdMetadataDocumentSupported).toBe(true);
    expect(authConfig?.resourceParameterSupported).toBe(true);
  });

  it('falls back to OpenID discovery when OAuth authorization metadata is unavailable', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url === 'https://api.emcy.ai/api/v1/workspaces/workspace_test/config') {
        return Response.json(createWorkspaceConfig({ authType: 'oauth2' }));
      }

      if (url === 'https://todo.example.com/.well-known/oauth-protected-resource') {
        return Response.json({
          resource: MCP_SERVER_URL,
          authorization_servers: ['https://auth.todo.example.com/tenant'],
          scopes_supported: ['todos.read'],
        });
      }

      if (url === 'https://auth.todo.example.com/.well-known/oauth-authorization-server/tenant') {
        return new Response(null, { status: 404 });
      }

      if (url === 'https://auth.todo.example.com/.well-known/openid-configuration/tenant') {
        return Response.json({
          issuer: 'https://auth.todo.example.com/tenant',
          authorization_endpoint: 'https://auth.todo.example.com/oauth/authorize',
          token_endpoint: 'https://auth.todo.example.com/oauth/token',
          registration_endpoint: 'https://auth.todo.example.com/connect/register',
          scopes_supported: ['todos.read'],
          client_id_metadata_document_supported: true,
          resource_parameter_supported: true,
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const agent = new EmcyAgent({
      apiKey: 'emcy-test-key',
      agentId: 'workspace_test',
    });

    await agent.init();

    const authConfig = agent.getServerAuthConfig(MCP_SERVER_URL);
    expect(authConfig?.authorizationServerUrl).toBe('https://auth.todo.example.com/tenant');
    expect(authConfig?.authorizationServerMetadataUrl)
      .toBe('https://auth.todo.example.com/.well-known/openid-configuration/tenant');
    expect(authConfig?.registrationEndpoint).toBe('https://auth.todo.example.com/connect/register');
  });

  it('prefers discovered resource metadata over stale stored resource values', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url === 'https://api.emcy.ai/api/v1/workspaces/workspace_test/config') {
        return Response.json(createWorkspaceConfig({
          authType: 'oauth2',
          authorizationServerUrl: 'https://auth.todo.example.com',
          authorizationServerMetadataUrl:
            'https://auth.todo.example.com/.well-known/oauth-authorization-server',
          clientId: 'todo-local',
          scopes: ['openid', 'todos.read'],
          resource: 'https://stale.todo.example.com/mcp',
        }));
      }

      if (url === 'https://todo.example.com/.well-known/oauth-protected-resource') {
        return Response.json({
          resource: 'https://api.todo.example.com/todos',
          authorization_servers: ['https://auth.todo.example.com'],
          scopes_supported: ['openid', 'todos.read'],
        });
      }

      if (url === 'https://auth.todo.example.com/.well-known/oauth-authorization-server') {
        return Response.json({
          issuer: 'https://auth.todo.example.com',
          authorization_endpoint: 'https://auth.todo.example.com/oauth/authorize',
          token_endpoint: 'https://auth.todo.example.com/oauth/token',
          resource_parameter_supported: true,
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const agent = new EmcyAgent({
      apiKey: 'emcy-test-key',
      agentId: 'workspace_test',
    });

    await agent.init();

    const authConfig = agent.getServerAuthConfig(MCP_SERVER_URL);
    expect(authConfig?.resource).toBe('https://api.todo.example.com/todos');
    expect(authConfig?.authorizationEndpoint).toBe('https://auth.todo.example.com/oauth/authorize');
  });

  it('respects explicit manual resource overrides when provided', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url === 'https://api.emcy.ai/api/v1/workspaces/workspace_test/config') {
        return Response.json(createWorkspaceConfig({
          authType: 'oauth2',
          authorizationServerUrl: 'https://auth.todo.example.com',
          authorizationServerMetadataUrl:
            'https://auth.todo.example.com/.well-known/oauth-authorization-server',
          clientId: 'todo-local',
          scopes: ['openid', 'todos.read'],
          resource: 'https://manual.todo.example.com/todos',
          manualOverrides: ['resource'],
        }));
      }

      if (url === 'https://todo.example.com/.well-known/oauth-protected-resource') {
        return Response.json({
          resource: 'https://api.todo.example.com/todos',
          authorization_servers: ['https://auth.todo.example.com'],
          scopes_supported: ['openid', 'todos.read'],
        });
      }

      if (url === 'https://auth.todo.example.com/.well-known/oauth-authorization-server') {
        return Response.json({
          issuer: 'https://auth.todo.example.com',
          authorization_endpoint: 'https://auth.todo.example.com/oauth/authorize',
          token_endpoint: 'https://auth.todo.example.com/oauth/token',
          resource_parameter_supported: true,
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const agent = new EmcyAgent({
      apiKey: 'emcy-test-key',
      agentId: 'workspace_test',
    });

    await agent.init();

    const authConfig = agent.getServerAuthConfig(MCP_SERVER_URL);
    expect(authConfig?.resource).toBe('https://manual.todo.example.com/todos');
    expect(authConfig?.manualOverrides).toEqual(['resource']);
  });

  it('defaults local standalone OAuth helpers to the Emcy web origin when agentServiceUrl is localhost', () => {
    const agent = new EmcyAgent({
      apiKey: 'emcy-test-key',
      agentId: 'workspace_test',
      agentServiceUrl: 'http://localhost:5150',
    });

    expect(agent.getOAuthCallbackUrl()).toBe('http://localhost:3100/oauth/callback');
    expect(agent.getOAuthClientMetadataUrl()).toBe(
      'http://localhost:3100/.well-known/oauth-client-metadata.json',
    );
  });

  it('surfaces the backend error message when workspace config auth fails', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url === 'https://api.emcy.ai/api/v1/workspaces/workspace_test/config') {
        return Response.json(
          { error: 'Invalid or expired API key' },
          { status: 401 },
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const agent = new EmcyAgent({
      apiKey: 'emcy-test-key',
      agentId: 'workspace_test',
    });

    await expect(agent.init()).rejects.toThrow('Invalid or expired API key');
  });

  it('sends resource and client_id on refresh token requests', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url === 'https://auth.todo.example.com/oauth/token') {
        const body = (init?.body as URLSearchParams).toString();
        expect(body).toContain('grant_type=refresh_token');
        expect(body).toContain('refresh_token=refresh-token-1');
        expect(body).toContain('client_id=https%3A%2F%2Femcy.ai%2F.well-known%2Foauth-client-metadata.json');
        expect(body).toContain('resource=https%3A%2F%2Ftodo.example.com');

        return Response.json({
          access_token: 'fresh-access-token',
          refresh_token: 'refresh-token-2',
          expires_in: 3600,
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const authConfig: McpServerAuthConfig = {
      authType: 'oauth2',
      authorizationServerUrl: 'https://auth.todo.example.com',
      tokenEndpoint: 'https://auth.todo.example.com/oauth/token',
      tokenUrl: 'https://auth.todo.example.com/oauth/token',
      clientId: 'https://emcy.ai/.well-known/oauth-client-metadata.json',
      clientMode: 'cimd',
      callbackUrl: 'https://emcy.ai/oauth/callback',
      resource: MCP_SERVER_URL,
      discovered: true,
    };

    const agent = new EmcyAgent({
      apiKey: 'emcy-test-key',
      agentId: 'workspace_test',
    });

    (agent as unknown as { agentConfig: AgentConfigResponse }).agentConfig = createWorkspaceConfig(authConfig);
    (agent as unknown as { storeOAuthToken: (url: string, token: OAuthTokenResponse) => void })
      .storeOAuthToken(MCP_SERVER_URL, {
        accessToken: 'expired-access-token',
        refreshToken: 'refresh-token-1',
        expiresIn: -10,
        resolvedAuthConfig: authConfig,
      });

    const token = await (agent as unknown as {
      resolveToken: (url: string) => Promise<string | undefined>;
    }).resolveToken(MCP_SERVER_URL);

    expect(token).toBe('fresh-access-token');
  });

  it('rehydrates cached DCR registrations so token reuse survives reloads', async () => {
    const baseAuthConfig: McpServerAuthConfig = {
      authType: 'oauth2',
      authorizationServerUrl: 'https://auth.todo.example.com',
      authorizationServerMetadataUrl:
        'https://auth.todo.example.com/.well-known/oauth-authorization-server',
      registrationEndpoint: 'https://auth.todo.example.com/connect/register',
      callbackUrl: 'https://emcy.ai/oauth/callback',
      resource: MCP_SERVER_URL,
      discovered: true,
    };

    const registrationCacheKey = buildRegistrationCacheKey(
      baseAuthConfig,
      'https://emcy.ai/oauth/callback',
      'dcr',
    );

    saveStoredRegistration({
      key: registrationCacheKey,
      mode: 'dcr',
      authorizationServerUrl: 'https://auth.todo.example.com',
      authorizationServerMetadataUrl:
        'https://auth.todo.example.com/.well-known/oauth-authorization-server',
      registrationEndpoint: 'https://auth.todo.example.com/connect/register',
      clientId: 'dcr-client-123',
      callbackUrl: 'https://emcy.ai/oauth/callback',
      resource: MCP_SERVER_URL,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const resolvedDcrAuthConfig = applyResolvedRegistration(baseAuthConfig, {
      cacheKey: registrationCacheKey,
      mode: 'dcr',
      clientId: 'dcr-client-123',
      callbackUrl: 'https://emcy.ai/oauth/callback',
      resource: MCP_SERVER_URL,
      authorizationServerUrl: 'https://auth.todo.example.com',
      authorizationServerMetadataUrl:
        'https://auth.todo.example.com/.well-known/oauth-authorization-server',
      registrationEndpoint: 'https://auth.todo.example.com/connect/register',
    });

    const firstAgent = new EmcyAgent({
      apiKey: 'emcy-test-key',
      agentId: 'workspace_test',
    });
    (firstAgent as unknown as { agentConfig: AgentConfigResponse }).agentConfig =
      createWorkspaceConfig(baseAuthConfig);
    (firstAgent as unknown as {
      storeOAuthToken: (url: string, token: OAuthTokenResponse) => void;
    }).storeOAuthToken(MCP_SERVER_URL, {
      accessToken: 'cached-dcr-token',
      refreshToken: 'refresh-token-1',
      expiresIn: 3600,
      resolvedAuthConfig: resolvedDcrAuthConfig,
    });

    const secondAgent = new EmcyAgent({
      apiKey: 'emcy-test-key',
      agentId: 'workspace_test',
    });
    (secondAgent as unknown as { agentConfig: AgentConfigResponse }).agentConfig =
      createWorkspaceConfig(baseAuthConfig);

    const token = await (secondAgent as unknown as {
      resolveToken: (url: string) => Promise<string | undefined>;
    }).resolveToken(MCP_SERVER_URL);

    expect(token).toBe('cached-dcr-token');
    expect(secondAgent.getServerAuthConfig(MCP_SERVER_URL)?.clientMode).toBe('dcr');
    expect(secondAgent.getServerAuthConfig(MCP_SERVER_URL)?.clientId).toBe('dcr-client-123');
  });

  it('scopes persisted OAuth tokens by authSessionKey', async () => {
    const authConfig: McpServerAuthConfig = {
      authType: 'oauth2',
      tokenEndpoint: 'https://auth.todo.example.com/oauth/token',
      tokenUrl: 'https://auth.todo.example.com/oauth/token',
      callbackUrl: 'https://emcy.ai/oauth/callback',
      resource: MCP_SERVER_URL,
      discovered: true,
    };

    const firstAgent = new EmcyAgent({
      apiKey: 'emcy-test-key',
      agentId: 'workspace_test',
      authSessionKey: 'session-a',
    });
    (firstAgent as unknown as { agentConfig: AgentConfigResponse }).agentConfig =
      createWorkspaceConfig(authConfig);
    (firstAgent as unknown as {
      storeOAuthToken: (url: string, token: OAuthTokenResponse) => void;
    }).storeOAuthToken(MCP_SERVER_URL, {
      accessToken: 'scoped-access-token',
      expiresIn: 3600,
      resolvedAuthConfig: authConfig,
    });

    const sameSessionAgent = new EmcyAgent({
      apiKey: 'emcy-test-key',
      agentId: 'workspace_test',
      authSessionKey: 'session-a',
    });
    (sameSessionAgent as unknown as { agentConfig: AgentConfigResponse }).agentConfig =
      createWorkspaceConfig(authConfig);

    const otherSessionAgent = new EmcyAgent({
      apiKey: 'emcy-test-key',
      agentId: 'workspace_test',
      authSessionKey: 'session-b',
    });
    (otherSessionAgent as unknown as { agentConfig: AgentConfigResponse }).agentConfig =
      createWorkspaceConfig(authConfig);

    const sameSessionToken = await (sameSessionAgent as unknown as {
      resolveToken: (url: string) => Promise<string | undefined>;
    }).resolveToken(MCP_SERVER_URL);
    const otherSessionToken = await (otherSessionAgent as unknown as {
      resolveToken: (url: string) => Promise<string | undefined>;
    }).resolveToken(MCP_SERVER_URL);

    expect(sameSessionToken).toBe('scoped-access-token');
    expect(otherSessionToken).toBeUndefined();
  });

  it('does not read legacy unscoped tokens when authSessionKey is present', async () => {
    const authConfig: McpServerAuthConfig = {
      authType: 'oauth2',
      tokenEndpoint: 'https://auth.todo.example.com/oauth/token',
      tokenUrl: 'https://auth.todo.example.com/oauth/token',
      callbackUrl: 'https://emcy.ai/oauth/callback',
      resource: MCP_SERVER_URL,
      discovered: true,
    };

    const legacyAgent = new EmcyAgent({
      apiKey: 'emcy-test-key',
      agentId: 'workspace_test',
    });
    (legacyAgent as unknown as { agentConfig: AgentConfigResponse }).agentConfig =
      createWorkspaceConfig(authConfig);
    (legacyAgent as unknown as {
      storeOAuthToken: (url: string, token: OAuthTokenResponse) => void;
    }).storeOAuthToken(MCP_SERVER_URL, {
      accessToken: 'legacy-access-token',
      expiresIn: 3600,
      resolvedAuthConfig: authConfig,
    });

    const scopedAgent = new EmcyAgent({
      apiKey: 'emcy-test-key',
      agentId: 'workspace_test',
      authSessionKey: 'fresh-session',
    });
    (scopedAgent as unknown as { agentConfig: AgentConfigResponse }).agentConfig =
      createWorkspaceConfig(authConfig);

    const token = await (scopedAgent as unknown as {
      resolveToken: (url: string) => Promise<string | undefined>;
    }).resolveToken(MCP_SERVER_URL);

    expect(token).toBeUndefined();
  });

  it('clears persisted MCP auth without deleting stored registrations', async () => {
    const authConfig: McpServerAuthConfig = {
      authType: 'oauth2',
      authorizationServerUrl: 'https://auth.todo.example.com',
      authorizationServerMetadataUrl:
        'https://auth.todo.example.com/.well-known/oauth-authorization-server',
      registrationEndpoint: 'https://auth.todo.example.com/connect/register',
      callbackUrl: 'https://emcy.ai/oauth/callback',
      resource: MCP_SERVER_URL,
      discovered: true,
    };

    const registrationCacheKey = buildRegistrationCacheKey(
      authConfig,
      'https://emcy.ai/oauth/callback',
      'dcr',
    );

    saveStoredRegistration({
      key: registrationCacheKey,
      mode: 'dcr',
      authorizationServerUrl: 'https://auth.todo.example.com',
      authorizationServerMetadataUrl:
        'https://auth.todo.example.com/.well-known/oauth-authorization-server',
      registrationEndpoint: 'https://auth.todo.example.com/connect/register',
      clientId: 'persisted-dcr-client',
      callbackUrl: 'https://emcy.ai/oauth/callback',
      resource: MCP_SERVER_URL,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const scopedAgent = new EmcyAgent({
      apiKey: 'emcy-test-key',
      agentId: 'workspace_test',
      authSessionKey: 'logout-session',
    });
    (scopedAgent as unknown as { agentConfig: AgentConfigResponse }).agentConfig =
      createWorkspaceConfig(authConfig);
    (scopedAgent as unknown as {
      storeOAuthToken: (url: string, token: OAuthTokenResponse) => void;
    }).storeOAuthToken(MCP_SERVER_URL, {
      accessToken: 'logout-token',
      expiresIn: 3600,
      resolvedAuthConfig: authConfig,
    });

    localStorage.setItem('emcy-oauth-callback:logout-state', JSON.stringify({ token: 'pending' }));
    clearPersistedMcpAuthState({ authSessionKey: 'logout-session' });

    expect(localStorage.getItem('emcy-oauth-callback:logout-state')).toBeNull();
    expect(loadStoredRegistration(registrationCacheKey)?.clientId).toBe('persisted-dcr-client');

    const postScopedClearAgent = new EmcyAgent({
      apiKey: 'emcy-test-key',
      agentId: 'workspace_test',
      authSessionKey: 'logout-session',
    });
    (postScopedClearAgent as unknown as { agentConfig: AgentConfigResponse }).agentConfig =
      createWorkspaceConfig(authConfig);

    const afterScopedClear = await (postScopedClearAgent as unknown as {
      resolveToken: (url: string) => Promise<string | undefined>;
    }).resolveToken(MCP_SERVER_URL);

    expect(afterScopedClear).toBeUndefined();

    const userBAgent = new EmcyAgent({
      apiKey: 'emcy-test-key',
      agentId: 'workspace_test',
      authSessionKey: 'logout-session-b',
    });
    (userBAgent as unknown as { agentConfig: AgentConfigResponse }).agentConfig =
      createWorkspaceConfig(authConfig);
    (userBAgent as unknown as {
      storeOAuthToken: (url: string, token: OAuthTokenResponse) => void;
    }).storeOAuthToken(MCP_SERVER_URL, {
      accessToken: 'user-b-token',
      expiresIn: 3600,
      resolvedAuthConfig: authConfig,
    });

    clearPersistedMcpAuth();

    const postLogoutAgent = new EmcyAgent({
      apiKey: 'emcy-test-key',
      agentId: 'workspace_test',
      authSessionKey: 'logout-session-b',
    });
    (postLogoutAgent as unknown as { agentConfig: AgentConfigResponse }).agentConfig =
      createWorkspaceConfig(authConfig);

    const userBToken = await (postLogoutAgent as unknown as {
      resolveToken: (url: string) => Promise<string | undefined>;
    }).resolveToken(MCP_SERVER_URL);

    expect(userBToken).toBeUndefined();
    expect(loadStoredRegistration(registrationCacheKey)?.clientId).toBe('persisted-dcr-client');
  });

  it('emits connected auth status after popup auth initializes the MCP session', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url === MCP_SERVER_URL) {
        const body = typeof init?.body === 'string' ? init.body : '';
        const headers = init?.headers as Record<string, string> | undefined;

        if (body.includes('"method":"initialize"')) {
          expect(headers?.Authorization).toBe('Bearer popup-access-token');
          return new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              result: {
                protocolVersion: '2025-11-25',
                capabilities: {},
                serverInfo: { name: 'Todo MCP', version: '1.0.0' },
              },
            }),
            {
              status: 200,
              headers: {
                'content-type': 'application/json',
                'mcp-session-id': 'session-123',
              },
            },
          );
        }

        if (body.includes('"method":"notifications/initialized"')) {
          expect(headers?.Authorization).toBe('Bearer popup-access-token');
          return new Response(null, { status: 202 });
        }
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const authConfig: McpServerAuthConfig = {
      authType: 'oauth2',
    };
    const onAuthRequired = vi.fn(async (): Promise<OAuthTokenResponse> => ({
      accessToken: 'popup-access-token',
      expiresIn: 3600,
      resolvedAuthConfig: authConfig,
    }));

    const agent = new EmcyAgent({
      apiKey: 'emcy-test-key',
      agentId: 'workspace_test',
      onAuthRequired,
    });

    (agent as unknown as { agentConfig: AgentConfigResponse }).agentConfig =
      createWorkspaceConfig(authConfig);

    const events: string[] = [];
    agent.on('mcp_auth_status', (event) => {
      events.push(event.authStatus);
    });

    const authenticated = await agent.authenticate(MCP_SERVER_URL);

    expect(authenticated).toBe(true);
    expect(onAuthRequired).toHaveBeenCalledWith(MCP_SERVER_URL, expect.objectContaining({
      authType: 'oauth2',
      clientMode: 'manual',
      callbackUrl: 'https://emcy.ai/oauth/callback',
    }));
    expect(events).toContain('connected');
    expect(agent.getMcpServers()).toEqual([{
      url: MCP_SERVER_URL,
      name: 'Todo MCP',
      authStatus: 'connected',
      canSignOut: true,
    }]);
  });

  it('signs out standalone OAuth servers by clearing local auth state', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url === MCP_SERVER_URL) {
        expect(init?.method).toBe('DELETE');
        expect(init?.headers).toMatchObject({
          'Mcp-Session-Id': 'session-123',
          Authorization: 'Bearer cached-access-token',
        });
        return new Response(null, { status: 204 });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const authConfig: McpServerAuthConfig = {
      authType: 'oauth2',
      tokenEndpoint: 'https://auth.todo.example.com/oauth/token',
      tokenUrl: 'https://auth.todo.example.com/oauth/token',
    };

    const agent = new EmcyAgent({
      apiKey: 'emcy-test-key',
      agentId: 'workspace_test',
    });

    (agent as unknown as { agentConfig: AgentConfigResponse }).agentConfig =
      createWorkspaceConfig(authConfig);
    (agent as unknown as {
      storeOAuthToken: (url: string, token: OAuthTokenResponse) => void;
    }).storeOAuthToken(MCP_SERVER_URL, {
      accessToken: 'cached-access-token',
      expiresIn: 3600,
      resolvedAuthConfig: authConfig,
    });
    (
      agent as unknown as {
        mcpSessions: Map<string, { sessionId: string | null; authStatus: 'connected' | 'needs_auth' }>;
      }
    ).mcpSessions.set(MCP_SERVER_URL, {
      sessionId: 'session-123',
      authStatus: 'connected',
    });

    await agent.signOutMcpServer(MCP_SERVER_URL);

    const token = await (agent as unknown as {
      resolveToken: (url: string) => Promise<string | undefined>;
    }).resolveToken(MCP_SERVER_URL);

    expect(token).toBeUndefined();
    expect(localStorage.length).toBe(0);
    expect(agent.getMcpServers()).toEqual([{
      url: MCP_SERVER_URL,
      name: 'Todo MCP',
      authStatus: 'needs_auth',
      canSignOut: true,
    }]);
  });

});
