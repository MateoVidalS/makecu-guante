import type { VoiceToken } from '../contracts/api';

export interface ToolCall {
  id: string;
  name: string;
  args?: Record<string, unknown>;
}
export type TransportEvent =
  | { type: 'audio'; data: string }
  | {
      type: 'transcript';
      role: 'coach' | 'patient';
      text: string;
      finished?: boolean;
    }
  | { type: 'activity'; talking: boolean }
  | { type: 'interrupt' }
  | { type: 'turnComplete' }
  | { type: 'tools'; calls: ToolCall[] }
  | { type: 'cancelTools'; ids: string[] }
  | { type: 'closed' };
export interface LiveTransport {
  connect(
    token: VoiceToken,
    receive: (event: TransportEvent) => void,
  ): Promise<void>;
  sendText(text: string, speak: boolean): void;
  sendAudio(data: string): void;
  endAudio(): void;
  respond(call: ToolCall, response: Record<string, unknown>): void;
  close(): void;
}

export class FakeTransport implements LiveTransport {
  receive: (event: TransportEvent) => void = () => {};
  texts: { text: string; speak: boolean }[] = [];
  responses: { call: ToolCall; response: Record<string, unknown> }[] = [];
  audio: string[] = [];
  fail = false;
  closed = false;
  async connect(_token: VoiceToken, receive: (event: TransportEvent) => void) {
    this.receive = receive;
    if (this.fail) throw new Error('Connection failed');
  }
  emit(event: TransportEvent) {
    this.receive(event);
  }
  sendText(text: string, speak: boolean) {
    this.texts.push({ text, speak });
  }
  sendAudio(data: string) {
    this.audio.push(data);
  }
  endAudio() {}
  respond(call: ToolCall, response: Record<string, unknown>) {
    this.responses.push({ call, response });
  }
  close() {
    this.closed = true;
  }
}
