import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppAgentController } from '../controller';
import type { AgentConfigResponse, McpServerAuthConfig } from '../../core/types';

const SERVICE_URL = 'https://api.emcy.test';
const MCP_SERVER_URL = 'https://todo.example.com/mcp';

const authConfig: McpServerAuthConfig = {
  authType: 'oauth2',
  authorizationEndpoint: 'https://todo.example.com/oauth/authorize',
  tokenEndpoint: 'https://todo.example.com/oauth/token',
  resource: MCP_SERVER_URL,
};

function createAgentConfig(): AgentConfigResponse {
  return {
    agentId: 'agent_test',
    name: 'Auth Agent',
    conversationResumeVersion: 'resume_v1',
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

describe('AppAgentController auth behavior', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('loads agent config before connecting an initially rendered auth chip', async () => {
    const onAuthRequired = vi.fn(async () => undefined);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url === `${SERVICE_URL}/api/v1/agents/agent_test/config`) {
        return Response.json(createAgentConfig());
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const controller = new AppAgentController({
      apiKey: '',
      agentId: 'agent_test',
      serviceUrl: SERVICE_URL,
      initialConnections: [
        {
          url: MCP_SERVER_URL,
          name: 'Todo MCP',
          authStatus: 'needs_auth',
          canSignOut: false,
        },
      ],
      onAuthRequired,
    });

    controller.start();
    await expect(controller.connect(MCP_SERVER_URL)).resolves.toBe(false);

    expect(fetchMock).toHaveBeenCalledWith(
      `${SERVICE_URL}/api/v1/agents/agent_test/config`,
      expect.any(Object),
    );
    expect(onAuthRequired).toHaveBeenCalledWith(
      MCP_SERVER_URL,
      expect.objectContaining(authConfig),
    );
  });
});
