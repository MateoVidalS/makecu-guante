import { describe, expect, it, vi } from 'vitest';
import type { LiveServerMessage } from '@google/genai';
import { GeminiLiveTransport } from './GeminiLiveTransport';
import type { TransportEvent } from './transport';
const sdk = vi.hoisted(() => ({
  options: {} as Record<string, unknown>,
  config: {} as {
    callbacks: {
      onmessage(message: LiveServerMessage): void;
      onclose(): void;
      onerror(): void;
    };
    model: string;
  },
  session: {
    sendClientContent: vi.fn(),
    sendRealtimeInput: vi.fn(),
    sendToolResponse: vi.fn(),
    close: vi.fn(),
  },
}));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    constructor(options: Record<string, unknown>) {
      sdk.options = options;
    }
    live = {
      connect: vi.fn(async (config) => {
        sdk.config = config;
        return sdk.session;
      }),
    };
  },
}));
describe('Google SDK transport adapter', () => {
  it('uses only the ephemeral token and processes all parts and transcription', async () => {
    const receive = vi.fn<(event: TransportEvent) => void>();
    const transport = new GeminiLiveTransport();
    await transport.connect(
      {
        token: 'auth_tokens/one',
        expires_at: '',
        model: 'live-model',
        voice: 'Puck',
        tools: [],
        system_instruction: 'server-locked',
      },
      receive,
    );
    expect(sdk.options).toEqual({
      apiKey: 'auth_tokens/one',
      httpOptions: { apiVersion: 'v1beta' },
    });
    expect(sdk.config.model).toBe('live-model');
    expect(sdk.config).not.toHaveProperty('config');
    sdk.config.callbacks.onmessage({
      serverContent: {
        interrupted: true,
        modelTurn: {
          parts: [
            { inlineData: { data: 'one', mimeType: 'audio/pcm;rate=24000' } },
            { inlineData: { data: 'two', mimeType: 'audio/pcm;rate=24000' } },
          ],
        },
        inputTranscription: { text: 'Pause', finished: true },
        outputTranscription: { text: 'Paused', finished: true },
        turnComplete: true,
      },
      toolCall: {
        functionCalls: [{ id: '1', name: 'pause_session', args: {} }],
      },
      toolCallCancellation: { ids: ['2'] },
      goAway: {},
    } as LiveServerMessage);
    expect(receive.mock.calls.map(([e]) => e.type)).toEqual([
      'interrupt',
      'audio',
      'audio',
      'transcript',
      'transcript',
      'activity',
      'activity',
      'turnComplete',
      'tools',
      'cancelTools',
      'closed',
    ]);
    transport.sendText('context', false);
    expect(sdk.session.sendClientContent).toHaveBeenCalledWith(
      expect.objectContaining({ turnComplete: false }),
    );
    transport.sendAudio('pcm');
    expect(sdk.session.sendRealtimeInput).toHaveBeenCalledWith({
      audio: { data: 'pcm', mimeType: 'audio/pcm;rate=16000' },
    });
    transport.respond({ id: '1', name: 'pause_session' }, { ok: true });
    expect(sdk.session.sendToolResponse).toHaveBeenCalledWith({
      functionResponses: [
        { id: '1', name: 'pause_session', response: { ok: true } },
      ],
    });
    receive.mockClear();
    transport.close();
    sdk.config.callbacks.onclose();
    sdk.config.callbacks.onerror();
    expect(receive).not.toHaveBeenCalled();
  });
});
