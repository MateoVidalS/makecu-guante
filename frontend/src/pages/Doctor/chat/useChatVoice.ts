import { useCallback, useEffect, useRef, useState } from 'react';
import { createChatVoiceToken } from '../../../api/client';
import { ChatLiveTransport, type ChatLiveCallbacks } from './ChatLiveTransport';
import { recognitionConstructor, type Recognition } from './dictation';

export function useChatVoice(
  callbacks: Omit<ChatLiveCallbacks, 'status' | 'closed'> & {
    dictate(text: string, final: boolean): void;
    error(): void;
  },
) {
  const receive = useRef(callbacks);
  receive.current = callbacks;
  const [mode, setMode] = useState<'off' | 'connecting' | 'live' | 'dictation'>(
    'off',
  );
  const [status, setStatus] = useState<'off' | 'listening' | 'speaking'>('off');
  const [fallback, setFallback] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [readAloud, setReadAloud] = useState(false);
  const live = useRef<ChatLiveTransport>();
  const recognition = useRef<Recognition>();
  const retry = useRef<ReturnType<typeof setTimeout>>();
  const generation = useRef(0);
  const dictationPaused = useRef(false);

  const stop = useCallback(() => {
    generation.current++;
    dictationPaused.current = false;
    clearTimeout(retry.current);
    live.current?.close();
    live.current = undefined;
    const current = recognition.current;
    recognition.current = undefined;
    if (current) {
      current.onend = null;
      current.onresult = null;
      current.onerror = null;
      current.abort();
    }
    globalThis.speechSynthesis?.cancel();
    setMode('off');
    setStatus('off');
    receive.current.turnComplete();
  }, []);
  useEffect(() => stop, [stop]);

  const start = async () => {
    stop();
    const id = generation.current;
    const current = () => generation.current === id;
    setMode('connecting');
    let token;
    try {
      token = await createChatVoiceToken();
    } catch {
      if (!current()) return;
      setFallback(true);
      const Constructor = recognitionConstructor();
      if (!Constructor) {
        setUnsupported(true);
        setMode('off');
        return;
      }
      const instance = new Constructor();
      recognition.current = instance;
      instance.lang = navigator.language;
      instance.continuous = true;
      instance.interimResults = true;
      instance.onresult = (event) => {
        if (!current() || dictationPaused.current) return;
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal)
            receive.current.dictate(result[0].transcript, true);
          else interim += result[0].transcript;
        }
        if (interim) receive.current.dictate(interim, false);
      };
      instance.onerror = (event) => {
        if (event.error === 'aborted' || event.error === 'no-speech') return;
        if (current()) {
          stop();
          receive.current.error();
        }
      };
      instance.onend = () => {
        if (current() && !dictationPaused.current)
          retry.current = setTimeout(() => {
            if (current() && !dictationPaused.current) {
              try {
                instance.start();
              } catch {
                stop();
                receive.current.error();
              }
            }
          }, 250);
      };
      try {
        instance.start();
        setMode('dictation');
        setStatus('listening');
      } catch {
        stop();
        receive.current.error();
      }
      return;
    }
    if (!current()) return;
    setFallback(false);
    const transport = new ChatLiveTransport();
    live.current = transport;
    try {
      await transport.connect(token, {
        transcript: (...args) => {
          if (current()) receive.current.transcript(...args);
        },
        turnComplete: () => {
          if (current()) receive.current.turnComplete();
        },
        status: (state) => {
          if (current()) setStatus(state);
        },
        tool: (label) => {
          if (current()) receive.current.tool(label);
        },
        closed: () => {
          if (current()) {
            stop();
            receive.current.error();
          }
        },
      });
      if (current()) {
        setMode('live');
        setStatus('listening');
      }
    } catch {
      if (current()) {
        stop();
        receive.current.error();
      }
    }
  };

  const speak = (text: string) => {
    if (!fallback || !readAloud || !globalThis.speechSynthesis || !text) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = navigator.language;
    const id = generation.current;
    utterance.onstart = () => {
      if (id !== generation.current) return;
      // Avoid dictating the synthesized answer back into the conversation.
      const instance = recognition.current;
      if (instance) {
        dictationPaused.current = true;
        clearTimeout(retry.current);
        instance.abort();
      }
      setStatus('speaking');
    };
    const finish = () => {
      if (id !== generation.current) return;
      dictationPaused.current = false;
      if (recognition.current) {
        try {
          recognition.current.start();
          setStatus('listening');
        } catch {
          stop();
        }
      } else setStatus('off');
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    speechSynthesis.speak(utterance);
  };
  return {
    mode,
    status,
    fallback,
    unsupported,
    readAloud,
    setReadAloud,
    start,
    stop,
    speak,
    sendText: (text: string) => live.current?.sendText(text),
  };
}
