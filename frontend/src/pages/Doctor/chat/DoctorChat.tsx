import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type {
  ChartSection,
  ChatMessage,
  ChatRole,
} from '../../../contracts/chat';
import { streamChat } from '../../../api/client';
import { DemoBadge, Icon, IconButton } from '../../../design-system';
import { isChartSection, showChart } from './showChart';
import { useChatVoice } from './useChatVoice';
import './chat.css';

export const CHAT_STORAGE_KEY = 'rehab.doctor-chat';
const CHART_NAMES: Record<ChartSection, string> = {
  summary: 'Therapist summary',
  glance: 'At a glance',
  range: 'Active range',
  assistance: 'Assistance',
  therapy: 'Feelings and coach decisions',
  sessions: 'Saved sessions',
  evaluations: 'Evaluations',
};
/** Plain-text answers: blank lines split paragraphs; a short line ending in ":" is a heading. */
function Answer({ text, caret }: { text: string; caret?: boolean }) {
  const blocks = text.split(/\n\s*\n/);
  return (
    <>
      {blocks.map((block, index) => {
        const [first, ...rest] = block.split('\n');
        const heading =
          rest.length > 0 &&
          first.trim().endsWith(':') &&
          first.trim().split(/\s+/).length <= 4;
        return (
          <p key={index}>
            {heading ? (
              <>
                <strong className="doctor-chat-heading">{first.trim()}</strong>
                {'\n' + rest.join('\n')}
              </>
            ) : (
              block
            )}
            {caret && index === blocks.length - 1 && (
              <span className="doctor-chat-caret" aria-hidden="true" />
            )}
          </p>
        );
      })}
    </>
  );
}
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

export function DoctorChat({
  patient,
  demo = false,
}: {
  /** Pseudonym shown in the panel; falls back to "this patient". */
  patient?: string;
  /** Records on the page include demo data. */
  demo?: boolean;
} = {}) {
  const [open, setOpen] = useState(false);
  const [charts, setCharts] = useState<Record<number, ChartSection>>({});
  const [copied, setCopied] = useState<number>();
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
    let chart: ChartSection | undefined;
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
              if (isChartSection(event.label)) {
                chart = event.label;
                void showChart(event.label);
              }
            } else setTool(event.label);
          } else if (event.type === 'error') setError(true);
          else if (event.type === 'done') {
            if (chart && answerIndex !== undefined) {
              const index = answerIndex,
                section = chart;
              setCharts((current) => ({ ...current, [index]: section }));
            }
            voice.speak(answer);
          }
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

  /** Resend the last question after an error, replacing its partial answer. */
  function retry() {
    const last = history.current.map((m) => m.role).lastIndexOf('user');
    if (last < 0) return;
    const text = history.current[last].text;
    update(history.current.slice(0, last));
    void send(text);
  }
  function copy(index: number, text: string) {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(index);
        setTimeout(
          () => setCopied((value) => (value === index ? undefined : value)),
          1500,
        );
      })
      .catch(() => {});
  }
  // Auto-grow the composer up to its CSS max height.
  useEffect(() => {
    const box = textarea.current;
    if (!box) return;
    box.style.height = 'auto';
    box.style.height = `${box.scrollHeight}px`;
  }, [input, open]);
  // On wide screens the page makes room for the panel instead of hiding under it.
  useEffect(() => {
    document.documentElement.classList.toggle('doctor-chat-open', open);
    return () => document.documentElement.classList.remove('doctor-chat-open');
  }, [open]);
  const who = patient?.trim() || 'this patient';
  const voiceOn = voice.mode !== 'off';
  const voiceLabel =
    voice.mode === 'connecting'
      ? 'Connecting to Gemini Live…'
      : voice.status === 'speaking'
        ? voice.mode === 'live'
          ? 'Gemini is speaking'
          : 'Reading the answer aloud'
        : voice.mode === 'live'
          ? 'Listening · speak or type'
          : 'Dictating · speak your question';
  const lastModel = messages.map((m) => m.role).lastIndexOf('model');
  const waiting =
    streaming && !tool && messages[messages.length - 1]?.role === 'user';

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
        <span className="doctor-chat-avatar" aria-hidden="true">
          <Icon name="sparkle" />
        </span>
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
            <span className="doctor-chat-avatar" aria-hidden="true">
              <Icon name="sparkle" />
            </span>
            <div className="doctor-chat-titles">
              <h2 id={`${panelId}-title`}>
                Ask Gemini {demo && <DemoBadge />}
              </h2>
              <p>Read-only · estimates, not medical advice</p>
            </div>
            <IconButton
              icon="plus"
              label="New chat"
              size="sm"
              title="New chat"
              disabled={messages.length === 0 && !error && !input}
              onClick={() => {
                stop();
                voice.stop();
                update([]);
                setCharts({});
                setInput('');
                setError(false);
                textarea.current?.focus();
              }}
            />
            <IconButton icon="x" label="Close chat" size="sm" onClick={close} />
          </header>
          <div
            className="doctor-chat-log"
            role="log"
            aria-live="polite"
            aria-label="Patient conversation"
            ref={log}
          >
            {messages.length === 0 && (
              <div className="doctor-chat-empty">
                <p className="doctor-chat-intro">
                  Ask about <strong>{who}</strong>: practice, movement,
                  check-ins and safety events. Answers come only from the stored
                  records.
                </p>
                <div
                  className="doctor-chat-suggestions"
                  aria-label="Suggested questions"
                >
                  {suggestions.map((question) => (
                    <button key={question} onClick={() => void send(question)}>
                      <span>{question}</span>
                      <Icon name="arrow-right" />
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((message, index) =>
              message.role === 'user' ? (
                <div
                  className="doctor-chat-message doctor-chat-message-user"
                  key={index}
                >
                  <span className="sr-only">You: </span>
                  <p>{message.text}</p>
                </div>
              ) : (
                <div
                  className="doctor-chat-message doctor-chat-message-model"
                  key={index}
                >
                  <span className="doctor-chat-role">
                    <Icon name="sparkle" size="1em" /> Gemini
                  </span>
                  <Answer
                    text={message.text}
                    caret={streaming && index === lastModel}
                  />
                  {!(streaming && index === lastModel) && (
                    <div className="doctor-chat-message-actions">
                      {charts[index] && (
                        <button
                          type="button"
                          className="doctor-chat-chip"
                          onClick={() => void showChart(charts[index])}
                        >
                          <Icon name="chart" size="1em" />
                          {CHART_NAMES[charts[index]]}
                        </button>
                      )}
                      <button
                        type="button"
                        className="doctor-chat-chip doctor-chat-chip--quiet"
                        onClick={() => copy(index, message.text)}
                      >
                        <Icon
                          name={copied === index ? 'check' : 'copy'}
                          size="1em"
                        />
                        {copied === index ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  )}
                </div>
              ),
            )}
            {waiting && (
              <div
                className="doctor-chat-thinking"
                aria-label="Gemini is thinking"
              >
                <span />
                <span />
                <span />
              </div>
            )}
            {tool && (
              <p className="doctor-chat-status" role="status">
                <span className="ds-spinner" aria-hidden="true" />
                {tool}
              </p>
            )}
            {error && (
              <div className="doctor-chat-error" role="alert">
                <Icon name="caution" />
                <p>{unavailable}</p>
                <button
                  type="button"
                  className="doctor-chat-chip"
                  onClick={retry}
                >
                  <Icon name="refresh" size="1em" />
                  Try again
                </button>
              </div>
            )}
          </div>
          {(voiceOn || voice.fallback) && (
            <div
              className="doctor-chat-voice"
              data-state={voice.mode === 'off' ? 'off' : voice.status}
            >
              {voiceOn && (
                <div className="doctor-chat-voice-row">
                  <span className="doctor-chat-bars" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </span>
                  <span className="doctor-chat-voice-label">{voiceLabel}</span>
                  <button
                    type="button"
                    className="doctor-chat-chip doctor-chat-chip--quiet"
                    onClick={() => voice.stop()}
                  >
                    End voice
                  </button>
                </div>
              )}
              {voice.fallback && (
                <p id={`${panelId}-voice-note`} className="doctor-chat-note">
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
            </div>
          )}
          <form
            className="doctor-chat-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <label htmlFor={`${panelId}-input`} className="sr-only">
              Ask about the patient’s records
            </label>
            <div className="doctor-chat-field">
              <textarea
                id={`${panelId}-input`}
                ref={textarea}
                rows={1}
                value={input}
                maxLength={4000}
                placeholder={
                  voice.mode === 'live'
                    ? 'Speak, or type a question…'
                    : 'Ask about the records…'
                }
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
              <button
                type="button"
                className="doctor-chat-round doctor-chat-mic"
                data-state={voice.mode === 'off' ? 'off' : voice.status}
                disabled={
                  voice.unsupported || (streaming && voice.mode === 'off')
                }
                aria-pressed={voiceOn}
                aria-label={`Mic ${voice.mode === 'connecting' ? 'connecting' : voice.status}`}
                title={voiceOn ? 'End voice' : 'Talk to Gemini'}
                aria-describedby={
                  voice.fallback ? `${panelId}-voice-note` : undefined
                }
                onClick={() => {
                  if (voice.mode === 'off') void voice.start();
                  else voice.stop();
                }}
              >
                <Icon name={voiceOn ? 'mic' : 'mic-off'} />
              </button>
              {streaming ? (
                <button
                  type="button"
                  className="doctor-chat-round doctor-chat-send"
                  aria-label="Stop"
                  title="Stop"
                  onClick={stop}
                >
                  <Icon name="stop" />
                </button>
              ) : (
                <button
                  type="submit"
                  className="doctor-chat-round doctor-chat-send"
                  aria-label="Send"
                  title="Send"
                  disabled={!input.trim() || voice.mode === 'connecting'}
                >
                  <Icon name="arrow-up" />
                </button>
              )}
            </div>
            <p className="doctor-chat-hint" aria-hidden="true">
              Enter to send · Shift+Enter for a new line
            </p>
          </form>
        </section>
      )}
    </div>
  );
}

export default DoctorChat;
