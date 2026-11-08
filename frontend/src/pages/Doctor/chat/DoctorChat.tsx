import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ChatMessage, ChatRole } from '../../../contracts/chat';
import { streamChat } from '../../../api/client';
import { isChartSection, showChart } from './showChart';
import { useChatVoice } from './useChatVoice';
import './chat.css';

export const CHAT_STORAGE_KEY = 'rehab.doctor-chat';
const unavailable =
  'Chat unavailable. Check the Gemini connection and try again.';
const suggestions = [
  'How has the index finger changed since the first opening session?',
  'What happened the week after the cold?',
  'Did pain change when the coach adjusted targets?',
  'Summarize the safety events.',
];
function restore(): ChatMessage[] {
  try {
    const stored: unknown = JSON.parse(
      sessionStorage.getItem(CHAT_STORAGE_KEY) ?? '[]',
    );
    if (!Array.isArray(stored)) return [];
    return stored
      .filter(
        (m): m is ChatMessage =>
          m &&
          (m.role === 'user' || m.role === 'model') &&
          typeof m.text === 'string' &&
          !!m.text.trim(),
      )
      .map((m) => ({ role: m.role, text: m.text.slice(0, 4000) }));
  } catch {
    return [];
  }
}

export function DoctorChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(restore);
  const history = useRef(messages);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [tool, setTool] = useState('');
  const [error, setError] = useState(false);
  const launcher = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const controller = useRef<AbortController>();
  const pendingDictation = useRef<string[]>([]);
  const latestSend = useRef<(text: string) => Promise<void>>();
  const transcriptIndices = useRef<Partial<Record<ChatRole, number>>>({});
  const panelId = useId();

  function update(next: ChatMessage[]) {
    history.current = next;
    setMessages(next);
  }
  const voice = useChatVoice({
    transcript(role, text, finished) {
      const next = [...history.current];
      const index = transcriptIndices.current[role] ?? next.length;
      next[index] = {
        role,
        text: ((next[index]?.text ?? '') + text).slice(0, 4000),
      };
      transcriptIndices.current[role] = index;
      update(next);
      if (finished) delete transcriptIndices.current[role];
    },
    turnComplete() {
      transcriptIndices.current = {};
      setTool('');
    },
    tool: setTool,
    error() {
      setError(true);
    },
    dictate(text, final) {
      setInput(text.slice(0, 4000));
      if (final) {
        if (controller.current) pendingDictation.current.push(text);
        else void send(text);
      }
    },
  });
  const stopVoice = voice.stop;

  useEffect(() => {
    try {
      sessionStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages));
    } catch {
      /* Storage is optional. */
    }
  }, [messages]);
  useEffect(() => {
    if (open) textarea.current?.focus();
    else if (returnFocus.current) {
      launcher.current?.focus();
      returnFocus.current = false;
    }
  }, [open]);
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [messages, tool]);
  useEffect(
    () => () => {
      controller.current?.abort();
      controller.current = undefined;
      pendingDictation.current = [];
    },
    [],
  );

  const stop = useCallback(() => {
    controller.current?.abort();
    controller.current = undefined;
    pendingDictation.current = [];
    setStreaming(false);
    setTool('');
  }, []);
  const close = useCallback(() => {
    stop();
    stopVoice();
    returnFocus.current = true;
    setOpen(false);
  }, [stop, stopVoice]);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [open, close]);
  async function send(value = input) {
    const text = value.trim().slice(0, 4000);
    if (!text || controller.current || voice.mode === 'connecting') return;
    setError(false);
    setInput('');
    const next: ChatMessage[] = [...history.current, { role: 'user', text }];
    update(next);
    if (voice.mode === 'live') {
      try {
        voice.sendText(text);
      } catch {
        setError(true);
        voice.stop();
      }
      return;
    }
    const request = new AbortController();
    controller.current = request;
    setStreaming(true);
    let answerIndex: number | undefined;
    let answer = '';
    try {
      await streamChat(next, {
        signal: request.signal,
        onEvent(event) {
          if (request.signal.aborted) return;
          if (event.type === 'delta') {
            answer += event.text;
            answerIndex ??= history.current.length;
            const updated = [...history.current];
            updated[answerIndex] = {
              role: 'model',
              text: answer.slice(0, 4000),
            };
            update(updated);
          } else if (event.type === 'tool') {
            if (event.name === 'show_chart') {
              setTool('Showing the chart');
              if (isChartSection(event.label)) void showChart(event.label);
            } else setTool(event.label);
          } else if (event.type === 'error') setError(true);
          else if (event.type === 'done') voice.speak(answer);
        },
      });
    } catch {
      if (!request.signal.aborted) setError(true);
    } finally {
      if (controller.current === request) {
        controller.current = undefined;
        setStreaming(false);
        setTool('');
        const pending = pendingDictation.current.shift();
        if (pending) void latestSend.current?.(pending);
      }
    }
  }
  latestSend.current = send;

  return (
    <div className="doctor-chat no-print">
      <button
        className="doctor-chat-launcher"
        ref={launcher}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(true)}
        hidden={open}
      >
        Ask about this patient
      </button>
      {open && (
        <section
          id={panelId}
          className="doctor-chat-panel"
          role="dialog"
          aria-labelledby={`${panelId}-title`}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              close();
            }
          }}
        >
          <header className="doctor-chat-header">
            <div>
              <h2 id={`${panelId}-title`}>Ask Gemini</h2>
              <p>Read-only · estimates, not medical advice</p>
            </div>
            <button onClick={close} aria-label="Close chat">
              Close
            </button>
          </header>
          <div
            className="doctor-chat-log"
            role="log"
            aria-live="polite"
            aria-label="Patient conversation"
            ref={log}
          >
            {messages.map((message, index) => (
              <div
                className={`doctor-chat-message doctor-chat-message-${message.role}`}
                key={index}
              >
                <span className="doctor-chat-role">
                  {message.role === 'user' ? 'You' : 'Gemini'}
                </span>
                <p>{message.text}</p>
              </div>
            ))}
            {messages.length === 0 && (
              <div
                className="doctor-chat-suggestions"
                aria-label="Suggested questions"
              >
                {suggestions.map((question) => (
                  <button key={question} onClick={() => void send(question)}>
                    {question}
                  </button>
                ))}
              </div>
            )}
            {tool && (
              <p className="doctor-chat-status" role="status">
                {tool}
              </p>
            )}
          </div>
          {error && (
            <p className="doctor-chat-error" role="alert">
              {unavailable}
            </p>
          )}
          <form
            className="doctor-chat-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <label htmlFor={`${panelId}-input`}>
              Ask about the patient’s records
            </label>
            <textarea
              id={`${panelId}-input`}
              ref={textarea}
              rows={3}
              value={input}
              maxLength={4000}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === 'Enter' &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <div className="doctor-chat-actions">
              <button
                type="submit"
                className="doctor-chat-send"
                disabled={
                  !input.trim() || streaming || voice.mode === 'connecting'
                }
              >
                Send
              </button>
              {streaming && (
                <button type="button" onClick={stop}>
                  Stop
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  stop();
                  voice.stop();
                  update([]);
                  setInput('');
                  setError(false);
                  textarea.current?.focus();
                }}
              >
                New chat
              </button>
              <button
                type="button"
                disabled={
                  voice.unsupported || (streaming && voice.mode === 'off')
                }
                aria-pressed={voice.mode !== 'off'}
                aria-describedby={
                  voice.fallback ? `${panelId}-voice-note` : undefined
                }
                onClick={() => {
                  if (voice.mode === 'off') void voice.start();
                  else voice.stop();
                }}
              >
                Mic {voice.mode === 'connecting' ? 'connecting' : voice.status}
              </button>
            </div>
            {voice.fallback && (
              <p id={`${panelId}-voice-note`} className="doctor-chat-status">
                {voice.unsupported
                  ? 'Live voice unavailable. Dictation is not supported in this browser.'
                  : 'Live voice unavailable, using dictation.'}
              </p>
            )}
            {voice.fallback && globalThis.speechSynthesis && (
              <label className="doctor-chat-read-aloud">
                <input
                  type="checkbox"
                  checked={voice.readAloud}
                  onChange={(event) => {
                    voice.setReadAloud(event.target.checked);
                    if (!event.target.checked) speechSynthesis.cancel();
                  }}
                />
                Read answers aloud
              </label>
            )}
          </form>
        </section>
      )}
    </div>
  );
}

export default DoctorChat;
