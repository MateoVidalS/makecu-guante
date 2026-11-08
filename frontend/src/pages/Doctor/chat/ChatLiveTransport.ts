import {
  GoogleGenAI,
  type LiveServerMessage,
  type Session,
} from '@google/genai';
import type {
  ChatRole,
  ChatToolName,
  ChatVoiceToken,
} from '../../../contracts/chat';
import { runChatTool } from '../../../api/client';
import { BrowserAudio } from '../../../voice/audio';
import { isChartSection, showChart } from './showChart';

export interface ChatLiveCallbacks {
  transcript(role: ChatRole, text: string, finished: boolean): void;
  turnComplete(): void;
  status(state: 'listening' | 'speaking'): void;
  tool(label: string): void;
  closed(): void;
}
const readTools: readonly string[] = [
  'get_session',
  'get_transcript',
  'get_evaluation',
  'compare',
  'find',
];

export class ChatLiveTransport {
  private session?: Session;
  private audio = new BrowserAudio();
  private stopped = false;
  private cancelled = new Set<string>();

  async connect(token: ChatVoiceToken, callbacks: ChatLiveCallbacks) {
    const ai = new GoogleGenAI({
      apiKey: token.token,
      httpOptions: { apiVersion: 'v1beta' },
    });
    const failed = () => {
      if (!this.stopped) {
        this.close();
        callbacks.closed();
      }
    };
    this.session = await ai.live.connect({
      model: token.model,
      callbacks: {
        onmessage: (message: LiveServerMessage) => {
          if (this.stopped) return;
          const content = message.serverContent;
          if (content?.interrupted) {
            this.audio.flush();
            callbacks.status('listening');
          }
          for (const [role, transcription] of [
            ['user', content?.inputTranscription],
            ['model', content?.outputTranscription],
          ] as const) {
            if (transcription?.text)
              callbacks.transcript(
                role,
                transcription.text,
                transcription.finished ?? false,
              );
          }
          for (const part of content?.modelTurn?.parts ?? []) {
            if (
              part.inlineData?.data &&
              part.inlineData.mimeType?.startsWith('audio/pcm')
            ) {
              this.audio.play(part.inlineData.data);
              callbacks.status('speaking');
            }
          }
          if (content?.turnComplete) {
            callbacks.turnComplete();
            callbacks.status('listening');
            callbacks.tool('');
          }
          for (const id of message.toolCallCancellation?.ids ?? [])
            this.cancelled.add(id);
          for (const call of message.toolCall?.functionCalls ?? []) {
            if (call.id && call.name)
              void this.tool(call.id, call.name, call.args ?? {}, callbacks);
          }
          if (message.goAway) failed();
        },
        onerror: failed,
        onclose: failed,
      },
    });
    if (this.stopped) {
      this.session.close();
      return;
    }
    if (token.context !== null)
      this.session.sendClientContent({
        turns: [{ role: 'user', parts: [{ text: token.context }] }],
        turnComplete: false,
      });
    await this.audio.open((data) => {
      if (!this.stopped) {
        try {
          this.session?.sendRealtimeInput({
            audio: { data, mimeType: 'audio/pcm;rate=16000' },
          });
        } catch {
          failed();
        }
      }
    });
    if (this.stopped) this.audio.close();
  }

  private async tool(
    id: string,
    name: string,
    args: Record<string, unknown>,
    callbacks: ChatLiveCallbacks,
  ) {
    callbacks.tool(
      name === 'show_chart'
        ? String(args.section ?? '')
        : 'Looking up patient records…',
    );
    let response: Record<string, unknown>;
    try {
      if (name === 'show_chart') {
        response = {
          shown:
            isChartSection(args.section) && (await showChart(args.section)),
        };
      } else if (readTools.includes(name)) {
        response = (await runChatTool(name as ChatToolName, args)).result;
      } else response = { error: 'unavailable' };
    } catch {
      response = { error: 'unavailable' };
    }
    if (!this.stopped && !this.cancelled.has(id)) {
      try {
        this.session?.sendToolResponse({
          functionResponses: [{ id, name, response }],
        });
      } catch {
        this.close();
        callbacks.closed();
      }
    }
    this.cancelled.delete(id);
  }

  sendText(text: string) {
    this.session?.sendClientContent({
      turns: [{ role: 'user', parts: [{ text }] }],
      turnComplete: true,
    });
  }

  close() {
    this.stopped = true;
    this.audio.close();
    this.session?.close();
    this.session = undefined;
  }
}
