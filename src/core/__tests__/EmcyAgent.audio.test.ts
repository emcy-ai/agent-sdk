import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmcyAgent } from '../EmcyAgent';
import type { AudioTranscriptFinalEvent } from '../types';

type AudioFrameActivity = {
  rms: number;
  peak: number;
  inputLevel: number;
  durationMs: number;
};

type TestAgentInternals = {
  audioSocket: { readyState: number; send: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> } | null;
  audioTurnState: unknown;
  createAudioTurnState(nowMs: number): unknown;
  processAudioTurnActivity(activity: AudioFrameActivity, nowMs: number): void;
  setAudioState(patch: Record<string, unknown>): void;
};

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

  it('upgrades audio websocket URLs when the host page is HTTPS', async () => {
    const openedUrls: string[] = [];
    class TestWebSocket {
      static OPEN = 1;
      static CONNECTING = 0;

      private listeners = new Map<string, Set<() => void>>();

      constructor(url: string) {
        openedUrls.push(url);
        queueMicrotask(() => {
          this.listeners.get('open')?.forEach((listener) => listener());
        });
      }

      addEventListener(type: string, listener: () => void) {
        const listeners = this.listeners.get(type) ?? new Set<() => void>();
        listeners.add(listener);
        this.listeners.set(type, listeners);
      }

      removeEventListener(type: string, listener: () => void) {
        this.listeners.get(type)?.delete(listener);
      }
    }

    vi.stubGlobal('window', {
      location: {
        protocol: 'https:',
        href: 'https://pr-44.preview.checklistsquad.com/app',
      },
    });
    vi.stubGlobal('WebSocket', TestWebSocket);
    const agent = new EmcyAgent({
      apiKey: 'emcy-test-key',
      agentId: 'agent_audio',
    });

    await (agent as unknown as {
      openAudioSocket(url: string): Promise<WebSocket>;
    }).openAudioSocket('ws://pr-44.preview.mcpstack.com/api/v1/agents/agent_audio/audio?token=test');

    expect(openedUrls).toEqual([
      'wss://pr-44.preview.mcpstack.com/api/v1/agents/agent_audio/audio?token=test',
    ]);
  });

  it('auto-commits microphone input after real speech followed by trailing silence', () => {
    vi.stubGlobal('WebSocket', { OPEN: 1, CONNECTING: 0 });
    const agent = new EmcyAgent({
      apiKey: 'emcy-test-key',
      agentId: 'agent_audio',
      audioInput: {
        turnDetection: {
          silenceDurationMs: 250,
          minSpeechDurationMs: 120,
          noSpeechTimeoutMs: 0,
        },
      },
    });
    const internals = agent as unknown as TestAgentInternals;
    const socket = { readyState: 1, send: vi.fn(), close: vi.fn() };
    internals.audioSocket = socket;
    internals.audioTurnState = internals.createAudioTurnState(0);
    internals.setAudioState({ status: 'listening', error: null });

    const speech = { rms: 0.05, peak: 0.12, inputLevel: 0.7, durationMs: 100 };
    const silence = { rms: 0.001, peak: 0.002, inputLevel: 0.01, durationMs: 100 };

    internals.processAudioTurnActivity(speech, 100);
    internals.processAudioTurnActivity(speech, 200);
    internals.processAudioTurnActivity(silence, 300);
    internals.processAudioTurnActivity(silence, 500);

    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'audio.commit' }));
    expect(agent.getAudioInputState().status).toBe('transcribing');
  });

  it('does not auto-commit a short microphone bump as speech', () => {
    vi.stubGlobal('WebSocket', { OPEN: 1, CONNECTING: 0 });
    const agent = new EmcyAgent({
      apiKey: 'emcy-test-key',
      agentId: 'agent_audio',
      audioInput: {
        turnDetection: {
          silenceDurationMs: 250,
          minSpeechDurationMs: 180,
          noSpeechTimeoutMs: 0,
        },
      },
    });
    const internals = agent as unknown as TestAgentInternals;
    const socket = { readyState: 1, send: vi.fn(), close: vi.fn() };
    internals.audioSocket = socket;
    internals.audioTurnState = internals.createAudioTurnState(0);
    internals.setAudioState({ status: 'listening', error: null });

    const bump = { rms: 0.05, peak: 0.12, inputLevel: 0.7, durationMs: 80 };
    const silence = { rms: 0.001, peak: 0.002, inputLevel: 0.01, durationMs: 100 };

    internals.processAudioTurnActivity(bump, 80);
    internals.processAudioTurnActivity(silence, 200);
    internals.processAudioTurnActivity(silence, 400);

    expect(socket.send).not.toHaveBeenCalledWith(JSON.stringify({ type: 'audio.commit' }));
    expect(agent.getAudioInputState().status).toBe('listening');
  });

  it('closes an idle microphone session when no speech is detected', () => {
    vi.stubGlobal('WebSocket', { OPEN: 1, CONNECTING: 0 });
    const agent = new EmcyAgent({
      apiKey: 'emcy-test-key',
      agentId: 'agent_audio',
      audioInput: {
        turnDetection: {
          noSpeechTimeoutMs: 300,
        },
      },
    });
    const internals = agent as unknown as TestAgentInternals;
    const socket = { readyState: 1, send: vi.fn(), close: vi.fn() };
    internals.audioSocket = socket;
    internals.audioTurnState = internals.createAudioTurnState(0);
    internals.setAudioState({ status: 'listening', error: null });

    const silence = { rms: 0.001, peak: 0.002, inputLevel: 0.01, durationMs: 100 };

    internals.processAudioTurnActivity(silence, 350);

    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'audio.close' }));
    expect(socket.send).not.toHaveBeenCalledWith(JSON.stringify({ type: 'audio.commit' }));
    expect(socket.close).toHaveBeenCalled();
    expect(agent.getAudioInputState().error?.code).toBe('no_speech_detected');
  });
});
