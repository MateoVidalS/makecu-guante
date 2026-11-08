// Doctor chat contract (docs/plan/03-contracts.md §4.1). Mirrors backend/app/contracts/chat.py.
// The doctor chat is read-only: its tools only read stored records, never the glove.

export type ChatRole = 'user' | 'model';

export type ChatToolName =
  | 'get_session'
  | 'get_transcript'
  | 'get_evaluation'
  | 'compare'
  | 'find'
  | 'show_chart';

/** Browser-only tool target: scrolls the Doctor view to a section. */
export type ChartSection =
  | 'summary'
  | 'glance'
  | 'range'
  | 'assistance'
  | 'therapy'
  | 'sessions'
  | 'evaluations';

export interface ChatMessage {
  role: ChatRole;
  /** 1–4000 characters. */
  text: string;
}

/** The server keeps no history: send the conversation, oldest first, last from the user (1–40). */
export interface ChatIn {
  messages: ChatMessage[];
}

/** POST /api/chat streams Server-Sent Events, `data: <json>\n\n`, ending with one done or error. */
export type ChatStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool'; name: ChatToolName; label: string }
  | { type: 'done'; model: string }
  | {
      type: 'error';
      code: 'chat_unavailable' | 'invalid_request';
      message: string;
    };

export interface ChatToolIn {
  args: Record<string, unknown>;
}

export interface ChatToolResult {
  name: ChatToolName;
  result: Record<string, unknown>;
}

export interface ChatVoiceToken {
  token: string;
  expires_at: string;
  model: string;
  voice: string;
  /** When set, send as the first silent client turn after connecting (the patient record). */
  context: string | null;
}
