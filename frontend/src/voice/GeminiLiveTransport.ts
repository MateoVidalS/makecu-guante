import {
  GoogleGenAI,
  type Session,
  type LiveServerMessage,
} from '@google/genai';
import type { VoiceToken } from '../contracts/api';
import type { LiveTransport, ToolCall, TransportEvent } from './transport';

export class GeminiLiveTransport implements LiveTransport {
  private session?: Session;
  private intentionalClose = false;
  async connect(token: VoiceToken, receive: (event: TransportEvent) => void) {
    const ai = new GoogleGenAI({
      apiKey: token.token,
      httpOptions: { apiVersion: 'v1beta' },
    });
    // All setup fields are locked by the server token. Do not duplicate config.
    this.session = await ai.live.connect({
      model: token.model,
      callbacks: {
        onmessage: (message: LiveServerMessage) => {
          const content = message.serverContent;
          if (content?.interrupted) receive({ type: 'interrupt' });
          for (const part of content?.modelTurn?.parts ?? []) {
            if (
              part.inlineData?.data &&
              part.inlineData.mimeType?.startsWith('audio/pcm')
            )
              receive({ type: 'audio', data: part.inlineData.data });
          }
          for (const [role, transcription] of [
            ['patient', content?.inputTranscription],
            ['coach', content?.outputTranscription],
          ] as const) {
            if (transcription?.text)
              receive({
                type: 'transcript',
                role,
                text: transcription.text,
                finished: transcription.finished,
              });
          }
          const activity = message.voiceActivity?.voiceActivityType;
          if (activity)
            receive({
              type: 'activity',
              talking: String(activity).includes('START'),
            });
          if (content?.interrupted)
            receive({ type: 'activity', talking: true });
          if (content?.turnComplete) {
            receive({ type: 'activity', talking: false });
            receive({ type: 'turnComplete' });
          }
          const calls = message.toolCall?.functionCalls?.flatMap((call) =>
            call.id && call.name
              ? [{ id: call.id, name: call.name, args: call.args }]
              : [],
          );
          if (calls?.length) receive({ type: 'tools', calls });
          if (message.toolCallCancellation?.ids)
            receive({
              type: 'cancelTools',
              ids: message.toolCallCancellation.ids,
            });
          if (message.goAway) receive({ type: 'closed' });
        },
        onerror: () => {
          if (!this.intentionalClose) receive({ type: 'closed' });
        },
        onclose: () => {
          if (!this.intentionalClose) receive({ type: 'closed' });
        },
      },
    });
    if (this.intentionalClose) this.session.close();
  }
  sendText(text: string, speak: boolean) {
    this.session?.sendClientContent({
      turns: [{ role: 'user', parts: [{ text }] }],
      turnComplete: speak,
    });
  }
  sendAudio(data: string) {
    this.session?.sendRealtimeInput({
      audio: { data, mimeType: 'audio/pcm;rate=16000' },
    });
  }
  endAudio() {
    this.session?.sendRealtimeInput({ audioStreamEnd: true });
  }
  respond(call: ToolCall, response: Record<string, unknown>) {
    this.session?.sendToolResponse({
      functionResponses: [{ id: call.id, name: call.name, response }],
    });
  }
  close() {
    this.intentionalClose = true;
    this.session?.close();
  }
}
