import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmcyAgent } from '../EmcyAgent';
import {
  applyResolvedRegistration,
  buildRegistrationCacheKey,
  saveStoredRegistration,
} from '../auth/registration';
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

  it('keeps the embedded getToken path unchanged', async () => {
    const getToken = vi.fn().mockResolvedValue({ accessToken: 'embedded-access-token' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const agent = new EmcyAgent({
      apiKey: 'emcy-test-key',
      agentId: 'workspace_test',
      getToken,
    });

    (agent as unknown as { agentConfig: AgentConfigResponse }).agentConfig = createWorkspaceConfig({
      authType: 'oauth2',
      tokenUrl: 'https://auth.todo.example.com/oauth/token',
    });

    const token = await (agent as unknown as {
      resolveToken: (url: string) => Promise<string | undefined>;
    }).resolveToken(MCP_SERVER_URL);

    expect(token).toBe('embedded-access-token');
    expect(getToken).toHaveBeenCalledWith(MCP_SERVER_URL);
    expect(fetchMock).not.toHaveBeenCalled();
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

  it('blocks embedded auto-token reuse after sign-out until the user reconnects', async () => {
    const getToken = vi.fn().mockResolvedValue({ accessToken: 'embedded-access-token' });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url === MCP_SERVER_URL) {
        const headers = init?.headers as Record<string, string> | undefined;
        if (init?.method === 'POST' && headers?.Authorization === 'Bearer embedded-access-token') {
          return new Response('{}', {
            status: 200,
            headers: { 'mcp-session-id': 'session-embedded' },
          });
        }

        if (init?.method === 'POST') {
          return new Response('{}', { status: 200 });
        }
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const agent = new EmcyAgent({
      apiKey: 'emcy-test-key',
      agentId: 'workspace_test',
      getToken,
    });

    (agent as unknown as { agentConfig: AgentConfigResponse }).agentConfig =
      createWorkspaceConfig({
        authType: 'bearer',
      });

    (
      agent as unknown as {
        mcpSessions: Map<string, { sessionId: string | null; authStatus: 'connected' | 'needs_auth' }>;
      }
    ).mcpSessions.set(MCP_SERVER_URL, {
      sessionId: null,
      authStatus: 'connected',
    });

    await agent.signOutMcpServer(MCP_SERVER_URL);

    const tokenWhileSignedOut = await (agent as unknown as {
      resolveToken: (url: string) => Promise<string | undefined>;
    }).resolveToken(MCP_SERVER_URL);

    expect(tokenWhileSignedOut).toBeUndefined();
    expect(agent.getMcpServers()[0]?.authStatus).toBe('needs_auth');

    const reconnected = await agent.authenticate(MCP_SERVER_URL);

    expect(reconnected).toBe(true);
    expect(agent.getMcpServers()[0]?.authStatus).toBe('connected');
    expect(getToken).toHaveBeenCalledWith(MCP_SERVER_URL);
  });
});
