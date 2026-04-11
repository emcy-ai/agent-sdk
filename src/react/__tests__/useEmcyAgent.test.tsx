import React, { forwardRef, useImperativeHandle } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmcyAgent } from '../../core/EmcyAgent';
import type { AgentConfigResponse, ChatMessage } from '../../core/types';
import { useEmcyAgent, type UseEmcyAgentReturn } from '../useEmcyAgent';

const AGENT_CONFIG: AgentConfigResponse = {
  agentId: 'agent_test',
  name: 'Auth Agent',
  mcpServers: [],
  widgetConfig: null,
};

const TestHarness = forwardRef<UseEmcyAgentReturn, { authSessionKey: string | null }>(
  ({ authSessionKey }, ref) => {
    const state = useEmcyAgent({
      apiKey: 'emcy-test-key',
      agentId: 'agent_test',
      authSessionKey,
    });

    useImperativeHandle(ref, () => state, [state]);
    return null;
  },
);

TestHarness.displayName = 'UseEmcyAgentTestHarness';

describe('useEmcyAgent', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    vi.spyOn(EmcyAgent.prototype, 'init').mockImplementation(async function mockInit(this: EmcyAgent) {
      (this as unknown as { agentConfig: AgentConfigResponse }).agentConfig = AGENT_CONFIG;
      return AGENT_CONFIG;
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('recreates the agent and clears hook state when authSessionKey changes', async () => {
    const cancelSpy = vi.spyOn(EmcyAgent.prototype, 'cancel');
    const ref = React.createRef<UseEmcyAgentReturn>();
    const { rerender } = render(<TestHarness ref={ref} authSessionKey="session-a" />);

    await waitFor(() => {
      expect(ref.current?.agentConfig?.agentId).toBe('agent_test');
    });

    const firstAgent = ref.current!.agent;
    const message: ChatMessage = {
      id: 'message-1',
      role: 'assistant',
      content: 'hello',
      timestamp: new Date(),
    };

    await act(async () => {
      (firstAgent as unknown as {
        emit: (event: 'message', payload: ChatMessage) => void;
      }).emit('message', message);
    });

    await waitFor(() => {
      expect(ref.current?.messages).toHaveLength(1);
    });

    rerender(<TestHarness ref={ref} authSessionKey="session-b" />);

    await waitFor(() => {
      expect(ref.current?.agent).not.toBe(firstAgent);
      expect(ref.current?.messages).toHaveLength(0);
      expect(ref.current?.conversationId).toBeNull();
    });

    await waitFor(() => {
      expect(ref.current?.agentConfig?.agentId).toBe('agent_test');
    });

    expect(cancelSpy).toHaveBeenCalled();
  });
});
