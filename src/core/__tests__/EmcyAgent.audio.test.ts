import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmcyAgent } from '../EmcyAgent';
import type { AudioTranscriptFinalEvent } from '../types';

describe('EmcyAgent audio input', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('reports unsupported browsers before creating a microphone session', async () => {
    const fetchMock = vi.fn(async () => Response.json({
      agentId: 'agent_audio',
      name: 'Audio Agent',
      conversationResumeVersion: 'resume_v1',
      mcpServers: [],
      widgetConfig: null,
      modelConfig: {
        id: 'gpt-realtime-1.5',
        provider: 'azure-openai-realtime',
        displayName: 'GPT-realtime-1.5',
        capabilities: {
          realtimeAudioInput: true,
          toolCalls: true,
        },
      },
      audio: {
        inputEnabled: true,
        outputEnabled: false,
        maxSessionSeconds: 300,
        transcriptionModel: 'gpt-4o-mini-transcribe',
      },
    }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('WebSocket', undefined);

    const agent = new EmcyAgent({
      apiKey: 'emcy-test-key',
      agentId: 'agent_audio',
    });

    const states: string[] = [];
    agent.on('audio_state', (state) => {
      states.push(state.error?.code ?? state.status);
    });

    await agent.startVoiceInput();

    expect(states).toContain('unsupported_browser');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('submits the final transcript through the existing composer path', async () => {
    const agent = new EmcyAgent({
      apiKey: 'emcy-test-key',
      agentId: 'agent_audio',
    });
    const sendSpy = vi.spyOn(agent, 'sendMessage').mockResolvedValue();
    const finals: AudioTranscriptFinalEvent[] = [];
    agent.on('audio_transcript_final', (event) => {
      finals.push(event);
    });

    await (agent as unknown as {
      handleAudioSocketMessage(event: { data: string }): Promise<void>;
    }).handleAudioSocketMessage({
      data: JSON.stringify({
        type: 'transcript_final',
        text: 'add a checklist item for renewing the permit',
      }),
    });

    expect(finals).toEqual([
      {
        text: 'add a checklist item for renewing the permit',
        transcript: 'add a checklist item for renewing the permit',
        conversationId: '',
      },
    ]);
    expect(sendSpy).toHaveBeenCalledWith('add a checklist item for renewing the permit');
  });
});
