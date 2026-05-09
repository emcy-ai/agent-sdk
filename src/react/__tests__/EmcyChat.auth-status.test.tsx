import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmcyChat } from '../EmcyChat';
import type { AgentConfigResponse } from '../../core/types';

const SERVICE_URL = 'https://api.emcy.test';
const MCP_SERVER_URL = 'https://api.emcy.test/api/v1/gateway/gw_todo/mcp';

function createAgentConfig(authStatus: 'connected' | 'needs_auth' = 'needs_auth'): AgentConfigResponse {
  return {
    agentId: 'agent_test',
    name: 'Todo Agent',
    conversationResumeVersion: 'resume_v1',
    mcpServers: [
      {
        id: 'server_todo',
        name: 'Todo MCP',
        url: MCP_SERVER_URL,
        authStatus,
        authConfig: {
          authType: 'oauth2',
          authorizationEndpoint: 'https://todo.example.com/oauth/authorize',
          tokenEndpoint: 'https://todo.example.com/oauth/token',
          resource: MCP_SERVER_URL,
        },
      },
    ],
    widgetConfig: null,
  };
}

describe('EmcyChat auth status rendering', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('renders MCP auth actions from fetched agent config in inline mode', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url === `${SERVICE_URL}/api/v1/agents/agent_test/config`) {
        return Response.json(createAgentConfig());
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }));

    render(
      <React.StrictMode>
        <EmcyChat
          apiKey=""
          agentId="agent_test"
          serviceUrl={SERVICE_URL}
          mode="inline"
          userIdentity={{
            subject: 'emcy:user_1',
            email: 'user1@example.com',
          }}
        />
      </React.StrictMode>,
    );

    await waitFor(() => {
      expect(screen.getByText('Todo MCP')).toBeDefined();
      expect(screen.getByRole('button', { name: 'Start AI' })).toBeDefined();
    });
  });

  it('renders connected MCP status without triggering a React update loop', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url === `${SERVICE_URL}/api/v1/agents/agent_test/config`) {
        return Response.json(createAgentConfig('connected'));
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }));

    render(
      <React.StrictMode>
        <EmcyChat
          apiKey=""
          agentId="agent_test"
          serviceUrl={SERVICE_URL}
          mode="inline"
          userIdentity={{
            subject: 'emcy:user_1',
            email: 'user1@example.com',
          }}
        />
      </React.StrictMode>,
    );

    await waitFor(() => {
      expect(screen.getByText('Todo MCP')).toBeDefined();
      expect(screen.getByText('Connected')).toBeDefined();
    });

    const errorMessages = consoleError.mock.calls
      .flat()
      .map((entry) => String(entry));
    expect(errorMessages.some((message) => message.includes('Maximum update depth exceeded'))).toBe(false);
  });
});
