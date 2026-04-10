import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmcyAgent } from '../EmcyAgent';

describe('EmcyAgent chat external user context', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('derives externalUser from embedded host identity when sending chat', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url === 'https://api.emcy.ai/api/v1/agents/agent_test/config') {
        return Response.json({
          agentId: 'agent_test',
          name: 'Chat Agent',
          mcpServers: [],
          widgetConfig: null,
        });
      }

      if (url === 'https://api.emcy.ai/api/v1/chat') {
        const body = JSON.parse(String(init?.body ?? '{}'));
        expect(body.externalUserId).toBeUndefined();
        expect(body.externalUser).toEqual({
          id: 'host-user-123',
          email: 'sarah@example.com',
          displayName: 'Sarah Kim',
          avatarUrl: 'https://cdn.example.com/sarah.png',
          organizationId: 'org_acme',
        });

        return new Response(
          'event: message_start\ndata: {"conversationId":"conv_test"}\n\n' +
            'event: message_end\ndata: {"inputTokens":1,"outputTokens":1,"toolCalls":0}\n\n',
          {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          },
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const agent = new EmcyAgent({
      apiKey: 'emcy-test-key',
      agentId: 'agent_test',
      embeddedAuth: {
        mismatchPolicy: 'block_with_switch',
        hostIdentity: {
          subject: 'host-user-123',
          email: 'sarah@example.com',
          displayName: 'Sarah Kim',
          avatarUrl: 'https://cdn.example.com/sarah.png',
          organizationId: 'org_acme',
        },
      },
    });

    await agent.init();
    await agent.sendMessage('hello');
  });

  it('prefers explicit externalUserId over host identity subject', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url === 'https://api.emcy.ai/api/v1/agents/agent_test/config') {
        return Response.json({
          agentId: 'agent_test',
          name: 'Chat Agent',
          mcpServers: [],
          widgetConfig: null,
        });
      }

      if (url === 'https://api.emcy.ai/api/v1/chat') {
        const body = JSON.parse(String(init?.body ?? '{}'));
        expect(body.externalUserId).toBe('customer-user-789');
        expect(body.externalUser).toMatchObject({
          id: 'customer-user-789',
          email: 'owner@example.com',
        });

        return new Response(
          'event: message_start\ndata: {"conversationId":"conv_test"}\n\n' +
            'event: message_end\ndata: {"inputTokens":1,"outputTokens":1,"toolCalls":0}\n\n',
          {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          },
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const agent = new EmcyAgent({
      apiKey: 'emcy-test-key',
      agentId: 'agent_test',
      externalUserId: 'customer-user-789',
      embeddedAuth: {
        mismatchPolicy: 'block_with_switch',
        hostIdentity: {
          subject: 'host-user-123',
          email: 'owner@example.com',
        },
      },
    });

    await agent.init();
    await agent.sendMessage('hello');
  });
});
