import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { http, HttpResponse } from 'msw';
import type { LiveServerMessage } from '@google/genai';
import { server } from '../../../mocks/server';
import { DoctorChat, CHAT_STORAGE_KEY } from './DoctorChat';
import { showChart } from './showChart';

const live = vi.hoisted(() => ({
  connect: vi.fn(),
  sendClientContent: vi.fn(),
  sendToolResponse: vi.fn(),
  sendRealtimeInput: vi.fn(),
  close: vi.fn(),
  open: vi.fn(async () => {}),
  audioClose: vi.fn(),
  play: vi.fn(),
  flush: vi.fn(),
  audio: undefined as { playing: boolean; onIdle?: () => void } | undefined,
  callbacks: undefined as
    | { onmessage(message: Partial<LiveServerMessage>): void; onclose(): void }
    | undefined,
}));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    live = { connect: live.connect };
  },
}));
vi.mock('../../../voice/audio', () => ({
  BrowserAudio: class {
    open = live.open;
    close = live.audioClose;
    play = live.play;
    flush = live.flush;
    playing = false;
    onIdle?: () => void;
    constructor() {
      live.audio = this;
    }
  },
}));
class FakeRecognition {
  static last: FakeRecognition;
  continuous = false;
  interimResults = false;
  lang = '';
  onresult:
    | ((event: {
        resultIndex: number;
        results: { isFinal: boolean; 0: { transcript: string } }[];
      }) => void)
    | null = null;
  onend: (() => void) | null = null;
  onerror = null;
  start = vi.fn();
  abort = vi.fn();
  constructor() {
    FakeRecognition.last = this;
  }
}
const sse = (events: object[]) =>
  new HttpResponse(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
    { headers: { 'Content-Type': 'text/event-stream' } },
  );
function open() {
  render(<DoctorChat />);
  fireEvent.click(
    screen.getByRole('button', { name: 'Ask about this patient' }),
  );
}
function send(text: string) {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
}
function enableLive() {
  server.use(
    http.post('/api/chat/voice-token', () =>
      HttpResponse.json({
        token: 'ephemeral',
        model: 'fixture-live',
        voice: 'Puck',
        context: 'Demo patient record',
        expires_at: '2099-01-01',
      }),
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Mic off' }));
}
const scroll = vi.fn();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
  live.connect.mockImplementation(async ({ callbacks }) => {
    live.callbacks = callbacks;
    return live;
  });
  vi.stubGlobal('SpeechRecognition', FakeRecognition);
  Element.prototype.scrollIntoView = scroll;
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
  vi.unstubAllGlobals();
});

describe('Doctor chat', () => {
  it('opens with input focus, closes with Escape or Close and returns focus', () => {
    open();
    expect(screen.getByRole('textbox')).toHaveFocus();
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'Read-only · estimates, not medical advice',
    );
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Ask about this patient' }),
    ).toHaveFocus();
    fireEvent.click(
      screen.getByRole('button', { name: 'Ask about this patient' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close chat' }));
    expect(
      screen.getByRole('button', { name: 'Ask about this patient' }),
    ).toHaveFocus();
  });
  it('sends a suggested question, displays tool status and streams a demo answer', async () => {
    open();
    fireEvent.click(
      screen.getByRole('button', { name: 'Summarize the safety events.' }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Looking up the Nov 3 session…',
    );
    expect(
      await screen.findByText(/Demo data: this is a sample answer/),
    ).toBeVisible();
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull(),
    );
    expect(screen.getByRole('log')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('log')).toHaveTextContent('Review the charts');
  });
  it('aborts with Stop and ignores subsequent chunks', async () => {
    let stream: ReadableStreamDefaultController<Uint8Array>;
    server.use(
      http.post(
        '/api/chat',
        () =>
          new HttpResponse(
            new ReadableStream({
              start(controller) {
                stream = controller;
                controller.enqueue(
                  new TextEncoder().encode(
                    'data: {"type":"delta","text":"Partial"}\n\n',
                  ),
                );
              },
            }),
            { headers: { 'Content-Type': 'text/event-stream' } },
          ),
      ),
    );
    const abort = vi.spyOn(AbortController.prototype, 'abort');
    open();
    send('Question');
    expect(await screen.findByText('Partial')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(abort).toHaveBeenCalled();
    await act(async () => {
      try {
        stream!.enqueue(
          new TextEncoder().encode('data: {"type":"delta","text":"late"}\n\n'),
        );
      } catch {
        /* Reader already cancelled. */
      }
    });
    expect(screen.queryByText('Partiallate')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('renders the friendly unavailable state for 503 and can start a new chat', async () => {
    server.use(
      http.post('/api/chat', () =>
        HttpResponse.json(
          { error: { code: 'chat_unavailable', message: 'No key' } },
          { status: 503 },
        ),
      ),
    );
    open();
    send('Question');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Chat unavailable. Check the Gemini connection and try again.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('textbox')).toHaveFocus();
    expect(JSON.parse(sessionStorage.getItem(CHAT_STORAGE_KEY)!)).toEqual([]);
  });
  it('retries the last question once, replacing the failed turn', async () => {
    const bodies: { messages: { role: string; text: string }[] }[] = [];
    let calls = 0;
    server.use(
      http.post('/api/chat', async ({ request }) => {
        bodies.push((await request.json()) as (typeof bodies)[number]);
        calls += 1;
        return calls === 1
          ? HttpResponse.json(
              { error: { code: 'chat_unavailable', message: 'Busy' } },
              { status: 503 },
            )
          : sse([
              { type: 'delta', text: 'Demo data: recovered.' },
              { type: 'done', model: 'fixture' },
            ]);
      }),
    );
    open();
    send('Why did one session end early?');
    fireEvent.click(
      within(await screen.findByRole('alert')).getByRole('button', {
        name: 'Try again',
      }),
    );
    expect(await screen.findByText('Demo data: recovered.')).toBeVisible();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(bodies[1].messages).toEqual([
      { role: 'user', text: 'Why did one session end early?' },
    ]);
    expect(screen.getAllByText('Why did one session end early?')).toHaveLength(
      1,
    );
  });
  it('shows answer headings and offers to copy a finished answer', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    server.use(
      http.post('/api/chat', () =>
        sse([
          {
            type: 'delta',
            text: 'Demo data.\n\nSafety:\nOne brake on Oct 27.',
          },
          { type: 'done', model: 'fixture' },
        ]),
      ),
    );
    open();
    send('Safety?');
    expect(await screen.findByText('Safety:')).toHaveClass(
      'doctor-chat-heading',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith(
      'Demo data.\n\nSafety:\nOne brake on Oct 27.',
    );
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeVisible();
  });
  it('restores history and sends only the last 20 bounded messages', async () => {
    const saved = Array.from({ length: 24 }, (_, index) => ({
      role: index % 2 ? 'model' : 'user',
      text: `Saved ${index}`,
    }));
    sessionStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(saved));
    let sent: { messages: { role: string; text: string }[] } | undefined;
    server.use(
      http.post('/api/chat', async ({ request }) => {
        sent = (await request.json()) as typeof sent;
        expect(request.headers.get('Accept')).toBe('text/event-stream');
        return sse([{ type: 'done', model: 'fixture' }]);
      }),
    );
    open();
    expect(screen.getByText('Saved 23')).toBeVisible();
    send('x'.repeat(4100));
    await waitFor(() => expect(sent?.messages).toHaveLength(20));
    expect(sent!.messages[0].text).toBe('Saved 5');
    expect(sent!.messages.at(-1)).toEqual({
      role: 'user',
      text: 'x'.repeat(4000),
    });
  });
  it('works when sessionStorage is unavailable and Shift+Enter does not send', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    server.use(
      http.post('/api/chat', () =>
        sse([
          { type: 'delta', text: '<b>Plain text</b>\nNext line' },
          { type: 'done', model: 'fixture' },
        ]),
      ),
    );
    open();
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Question' },
    });
    fireEvent.keyDown(screen.getByRole('textbox'), {
      key: 'Enter',
      shiftKey: true,
    });
    expect(screen.getByRole('log')).not.toHaveTextContent('Question');
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(await screen.findByText(/<b>Plain text<\/b>/)).toBeVisible();
    expect(screen.getByRole('log').querySelector('b')).toBeNull();
  });
  it('opens closed details, allows lazy rendering, and scrolls to the chart', async () => {
    render(
      <details
        data-chat-section="therapy"
        onToggle={(event) => {
          if (event.currentTarget.open)
            event.currentTarget.dataset.rendered = 'true';
        }}
      >
        <summary>Therapy</summary>
        <p>Chart</p>
      </details>,
    );
    await act(async () => {
      await showChart('therapy');
    });
    const details = document.querySelector('details')!;
    expect(details.open).toBe(true);
    expect(details.dataset.rendered).toBe('true');
    expect(details).toHaveClass('doctor-chat-highlight');
    expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  });
  it('handles show_chart events locally', async () => {
    render(<div data-chat-section="range">Range chart</div>);
    server.use(
      http.post('/api/chat', () =>
        sse([
          { type: 'tool', name: 'show_chart', label: 'range' },
          { type: 'done', model: 'fixture' },
        ]),
      ),
    );
    open();
    send('Show range');
    await waitFor(() =>
      expect(screen.getByText('Range chart')).toHaveClass(
        'doctor-chat-highlight',
      ),
    );
  });
});

describe('Doctor chat voice', () => {
  it('falls back on token 503, puts interim dictation in the input and sends final text', async () => {
    server.use(
      http.post('/api/chat', () =>
        sse([
          { type: 'delta', text: 'Dictation answer' },
          { type: 'done', model: 'fixture' },
        ]),
      ),
    );
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Mic off' }));
    expect(
      await screen.findByText('Live voice unavailable, using dictation.'),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Mic listening' }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(FakeRecognition.last.lang).toBe(navigator.language);
    act(() =>
      FakeRecognition.last.onresult?.({
        resultIndex: 0,
        results: [{ isFinal: false, 0: { transcript: 'Interim words' } }],
      }),
    );
    expect(screen.getByRole('textbox')).toHaveValue('Interim words');
    act(() =>
      FakeRecognition.last.onresult?.({
        resultIndex: 0,
        results: [{ isFinal: true, 0: { transcript: 'Final question' } }],
      }),
    );
    expect(await screen.findByText('Dictation answer')).toBeVisible();
    expect(screen.getByRole('log')).toHaveTextContent('Final question');
    fireEvent.click(screen.getByRole('button', { name: 'Mic listening' }));
    expect(FakeRecognition.last.abort).toHaveBeenCalled();
  });
  it('disables the mic with an explanation when dictation is unsupported', async () => {
    vi.stubGlobal('SpeechRecognition', undefined);
    vi.stubGlobal('webkitSpeechRecognition', undefined);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Mic off' }));
    expect(await screen.findByText(/Dictation is not supported/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Mic off' })).toBeDisabled();
  });
  it('keeps the mic closed while a Live reply plays, then listens again', async () => {
    open();
    enableLive();
    await screen.findByRole('button', { name: 'Mic listening' });
    const sendMic = (
      live.open.mock.calls.at(-1) as unknown as [(d: string) => void]
    )[0];
    live.sendRealtimeInput.mockClear();
    sendMic('before');
    expect(live.sendRealtimeInput).toHaveBeenCalledTimes(1);
    act(() => {
      live.audio!.playing = true;
      live.callbacks!.onmessage({
        serverContent: {
          modelTurn: {
            parts: [
              {
                inlineData: { data: 'AAAA', mimeType: 'audio/pcm;rate=24000' },
              },
            ],
          },
        },
      });
      live.callbacks!.onmessage({ serverContent: { turnComplete: true } });
    });
    // The reply is still playing after turnComplete: speaking, and the room is not sent.
    expect(screen.getByRole('button', { name: 'Mic speaking' })).toBeVisible();
    sendMic('own voice through the speakers');
    expect(live.sendRealtimeInput).toHaveBeenCalledTimes(1);
    act(() => {
      live.audio!.playing = false;
      live.audio!.onIdle?.();
    });
    expect(screen.getByRole('button', { name: 'Mic listening' })).toBeVisible();
    sendMic('next question');
    expect(live.sendRealtimeInput).toHaveBeenCalledTimes(2);
  });
  it('uses Live transcripts, typed turns and read-only tool responses; closes audio on unmount', async () => {
    const toolRequest = vi.fn();
    server.use(
      http.post('/api/chat/tools/get_session', async ({ request }) => {
        toolRequest(await request.json());
        return HttpResponse.json({
          name: 'get_session',
          result: { is_demo: true, id: 3 },
        });
      }),
    );
    open();
    enableLive();
    await screen.findByRole('button', { name: 'Mic listening' });
    expect(live.connect.mock.calls[0][0]).not.toHaveProperty('config');
    expect(live.sendClientContent).toHaveBeenCalledWith({
      turns: [{ role: 'user', parts: [{ text: 'Demo patient record' }] }],
      turnComplete: false,
    });
    act(() => {
      live.callbacks!.onmessage({
        serverContent: {
          inputTranscription: { text: 'How ', finished: false },
        },
      });
      live.callbacks!.onmessage({
        serverContent: {
          inputTranscription: { text: 'am I?', finished: true },
          outputTranscription: { text: 'Demo ', finished: false },
        },
      });
      live.callbacks!.onmessage({
        serverContent: {
          outputTranscription: { text: 'answer', finished: true },
          turnComplete: true,
        },
      });
    });
    expect(screen.getByRole('log')).toHaveTextContent('How am I?');
    expect(screen.getByRole('log')).toHaveTextContent('Demo answer');
    send('Typed follow-up');
    expect(live.sendClientContent).toHaveBeenLastCalledWith({
      turns: [{ role: 'user', parts: [{ text: 'Typed follow-up' }] }],
      turnComplete: true,
    });
    act(() =>
      live.callbacks!.onmessage({
        toolCall: {
          functionCalls: [
            { id: 'call-1', name: 'get_session', args: { id: 3 } },
          ],
        },
      }),
    );
    await waitFor(() =>
      expect(live.sendToolResponse).toHaveBeenCalledWith({
        functionResponses: [
          {
            id: 'call-1',
            name: 'get_session',
            response: { is_demo: true, id: 3 },
          },
        ],
      }),
    );
    expect(toolRequest).toHaveBeenCalledWith({ args: { id: 3 } });
    cleanup();
    expect(live.close).toHaveBeenCalled();
    expect(live.audioClose).toHaveBeenCalled();
  });
  it('handles Live show_chart locally and replies unavailable when a record tool fails', async () => {
    const forbidden = vi.fn();
    server.use(
      http.post('/api/chat/tools/show_chart', () => {
        forbidden();
        return HttpResponse.error();
      }),
      http.post('/api/chat/tools/find', () => HttpResponse.error()),
    );
    render(
      <details>
        <summary>More</summary>
        <div data-chat-section="sessions">Sessions chart</div>
      </details>,
    );
    open();
    enableLive();
    await screen.findByRole('button', { name: 'Mic listening' });
    act(() =>
      live.callbacks!.onmessage({
        toolCall: {
          functionCalls: [
            { id: 'chart', name: 'show_chart', args: { section: 'sessions' } },
            { id: 'fail', name: 'find', args: {} },
          ],
        },
      }),
    );
    await waitFor(() =>
      expect(live.sendToolResponse).toHaveBeenCalledWith({
        functionResponses: [
          { id: 'chart', name: 'show_chart', response: { shown: true } },
        ],
      }),
    );
    expect(document.querySelector('details')!.open).toBe(true);
    expect(forbidden).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(live.sendToolResponse).toHaveBeenCalledWith({
        functionResponses: [
          { id: 'fail', name: 'find', response: { error: 'unavailable' } },
        ],
      }),
    );
  });
});

it('reads fallback answers aloud, pauses dictation, and resumes listening', async () => {
  class Utterance {
    lang = '';
    onstart?: () => void;
    onend?: () => void;
    onerror?: () => void;
    constructor(public text: string) {}
  }
  let utterance: Utterance | undefined;
  const speak = vi.fn((value: Utterance) => {
    utterance = value;
    value.onstart?.();
  });
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance);
  vi.stubGlobal('speechSynthesis', { speak, cancel: vi.fn() });
  server.use(
    http.post('/api/chat', () =>
      sse([
        { type: 'delta', text: 'Spoken demo answer' },
        { type: 'done', model: 'fixture' },
      ]),
    ),
  );
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Mic off' }));
  await screen.findByText('Live voice unavailable, using dictation.');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Read answers aloud' }));
  send('Read the answer');
  await waitFor(() => expect(speak).toHaveBeenCalled());
  expect(utterance!.text).toBe('Spoken demo answer');
  expect(screen.getByRole('button', { name: 'Mic speaking' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(FakeRecognition.last.abort).toHaveBeenCalled();
  act(() => utterance!.onend?.());
  expect(screen.getByRole('button', { name: 'Mic listening' })).toBeVisible();
  expect(FakeRecognition.last.start).toHaveBeenCalledTimes(2);
});

it('does not open audio when a stopped Live connection resolves late', async () => {
  let resolve: (session: typeof live) => void;
  live.connect.mockImplementation(({ callbacks }) => {
    live.callbacks = callbacks;
    return new Promise((done) => {
      resolve = done;
    });
  });
  open();
  enableLive();
  await waitFor(() => expect(live.connect).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: 'Mic connecting' }));
  await act(async () => resolve!(live));
  expect(live.open).not.toHaveBeenCalled();
  expect(live.close).toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Mic off' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});

it('queues final dictation received while a text answer is streaming', async () => {
  let releaseFirst!: () => void;
  const waiting = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const requests: string[] = [];
  server.use(
    http.post('/api/chat', async ({ request }) => {
      const body = (await request.json()) as { messages: { text: string }[] };
      requests.push(body.messages.at(-1)!.text);
      if (requests.length === 1) await waiting;
      return sse([
        { type: 'delta', text: `Answer ${requests.length}` },
        { type: 'done', model: 'fixture' },
      ]);
    }),
  );
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Mic off' }));
  await screen.findByText('Live voice unavailable, using dictation.');
  act(() =>
    FakeRecognition.last.onresult?.({
      resultIndex: 0,
      results: [{ isFinal: true, 0: { transcript: 'First question' } }],
    }),
  );
  await waitFor(() => expect(requests).toEqual(['First question']));
  act(() =>
    FakeRecognition.last.onresult?.({
      resultIndex: 0,
      results: [{ isFinal: true, 0: { transcript: 'Next question' } }],
    }),
  );
  await act(async () => releaseFirst());
  expect(await screen.findByText('Answer 2')).toBeVisible();
  expect(requests).toEqual(['First question', 'Next question']);
});

it('respects reduced motion and removes the temporary chart highlight', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  try {
    render(<div data-chat-section="summary">Summary chart</div>);
    await act(async () => {
      await showChart('summary');
    });
    expect(scroll).toHaveBeenCalledWith({
      behavior: 'instant',
      block: 'start',
    });
    expect(screen.getByText('Summary chart')).toHaveClass(
      'doctor-chat-highlight',
    );
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByText('Summary chart')).not.toHaveClass(
      'doctor-chat-highlight',
    );
  } finally {
    vi.useRealTimers();
  }
});
