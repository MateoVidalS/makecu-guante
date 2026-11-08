import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Profile,
  Health,
  Session,
  SessionDetail,
  Attempt,
  Evaluation,
  TranscriptLine,
  Summary,
  VoiceToken,
  HistoryOverview,
  RomPoint,
  AssistPoint,
  ResistancePoint,
  CalibrationIn,
  SessionIn,
  EvaluationIn,
  SummaryIn,
  ApiError,
} from '../contracts/api';
import type { Calibration } from '../contracts/calibration';
import type {
  AttemptResult,
  AttemptTrace,
  SessionSummary,
} from '../contracts/engine';
import type { GloveFinger } from '../contracts/glove';
import type { PoseId } from '../contracts/poses';
import type {
  ChatMessage,
  ChatStreamEvent,
  ChatToolName,
  ChatToolResult,
  ChatVoiceToken,
} from '../contracts/chat';
import { parseChatEvents } from './sse';

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    public detail: ApiError['error'],
  ) {
    super(detail.message);
  }
}
/** Shown when the local server cannot be reached or answers without a usable error. */
export const SERVER_UNREACHABLE_MESSAGE =
  "Can't reach the memo server. Check that it is running, then try again.";

/** A network failure (server stopped, proxy up but API down) never surfaces as a raw parser or fetch error. */
async function send(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw new ApiRequestError(0, {
      code: 'unreachable',
      message: SERVER_UNREACHABLE_MESSAGE,
    });
  }
}

/** The API answers errors as `{ error: { code, message } }`; anything else (an empty proxy 500, an HTML page) is "unreachable". */
async function failure(response: Response): Promise<ApiRequestError> {
  try {
    const body = (await response.json()) as Partial<ApiError>;
    if (body?.error && typeof body.error.message === 'string')
      return new ApiRequestError(response.status, body.error);
  } catch {
    /* Not the API's JSON error. */
  }
  return new ApiRequestError(response.status, {
    code: 'unreachable',
    message: SERVER_UNREACHABLE_MESSAGE,
  });
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await send(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!response.ok) throw await failure(response);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
const body = (method: string, value?: unknown): RequestInit => ({
  method,
  ...(value === undefined ? {} : { body: JSON.stringify(value) }),
});
const query = (values: object) => {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([k, v]) => {
    if (v !== undefined) params.set(k, String(v));
  });
  const s = params.toString();
  return s ? `?${s}` : '';
};
export interface SessionFilters {
  mode?: 'exercise';
  limit?: number;
  offset?: number;
}
export interface RomFilters {
  finger?: GloveFinger;
  pose?: PoseId;
}
export interface SummaryFilters {
  kind?: 'session' | 'therapist';
  limit?: number;
}

export const getHealth = () => request<Health>('/health');
export const getProfile = () => request<Profile>('/profile');
export const putProfile = (value: Profile) =>
  request<Profile>('/profile', body('PUT', value));
export const getLatestCalibration = () =>
  request<Calibration | null>('/calibrations/latest');
export const getCalibrations = () => request<Calibration[]>('/calibrations');
export const createCalibration = (value: CalibrationIn) =>
  request<Calibration>('/calibrations', body('POST', value));
export const createSession = (value: SessionIn) =>
  request<Session>('/sessions', body('POST', value));
export const getSessions = (filters: SessionFilters = {}) =>
  request<Session[]>(`/sessions${query(filters)}`);
export const getSession = (id: number) =>
  request<SessionDetail>(`/sessions/${id}`);
export const addAttempt = ({
  id,
  result,
}: {
  id: number;
  result: AttemptResult;
}) => request<Attempt>(`/sessions/${id}/attempts`, body('POST', result));
export const endSession = ({
  id,
  summary,
}: {
  id: number;
  summary: SessionSummary;
}) => request<Session>(`/sessions/${id}/end`, body('POST', { summary }));
export const deleteSession = (id: number) =>
  request<void>(`/sessions/${id}`, body('DELETE'));
export const getAttemptTrace = (id: number) =>
  request<AttemptTrace>(`/attempts/${id}/trace`);
export const createEvaluation = (value: EvaluationIn) =>
  request<Evaluation>('/evaluations', body('POST', value));
export const getEvaluations = () => request<Evaluation[]>('/evaluations');
export const getEvaluation = (id: number) =>
  request<Evaluation>(`/evaluations/${id}`);
export const addTranscript = ({
  id,
  lines,
}: {
  id: number;
  lines: TranscriptLine[];
}) => request<void>(`/sessions/${id}/transcript`, body('POST', { lines }));
export const getHistoryOverview = () =>
  request<HistoryOverview>('/history/overview');
export const getHistoryRom = (filters: RomFilters = {}) =>
  request<RomPoint[]>(`/history/rom${query(filters)}`);
export const getHistoryAssist = () => request<AssistPoint[]>('/history/assist');
export const getHistoryResistance = () =>
  request<ResistancePoint[]>('/history/resistance');
export const createSummary = (value: SummaryIn) =>
  request<Summary>('/summaries', body('POST', value));
export const getSummaries = (filters: SummaryFilters = {}) =>
  request<Summary[]>(`/summaries${query(filters)}`);
export const createVoiceToken = (session_id: number | null) =>
  request<VoiceToken>('/voice/token', body('POST', { session_id }));
export async function exportData(
  format: 'json' | 'csv' = 'json',
): Promise<Blob> {
  const response = await send(`/api/export?format=${format}`);
  if (!response.ok) throw await failure(response);
  return response.blob();
}

export const useHealth = () =>
  // Gemini availability can change while a tab stays open (a key added, a backend restart):
  // never trust a health answer older than 10 s when deciding the voice mode.
  useQuery({
    queryKey: ['health'],
    queryFn: getHealth,
    staleTime: 10_000,
    refetchOnMount: 'always',
  });
export const useProfile = () =>
  useQuery({ queryKey: ['profile'], queryFn: getProfile });
export const useLatestCalibration = () =>
  useQuery({
    queryKey: ['calibrations', 'latest'],
    queryFn: getLatestCalibration,
  });
export const useCalibrations = () =>
  useQuery({ queryKey: ['calibrations'], queryFn: getCalibrations });
export const useSessions = (filters: SessionFilters = {}) =>
  useQuery({
    queryKey: ['sessions', filters],
    queryFn: () => getSessions(filters),
  });
export const useSession = (id: number) =>
  useQuery({ queryKey: ['sessions', id], queryFn: () => getSession(id) });
export const useAttemptTrace = (id: number) =>
  useQuery({ queryKey: ['traces', id], queryFn: () => getAttemptTrace(id) });
export const useEvaluations = () =>
  useQuery({ queryKey: ['evaluations'], queryFn: getEvaluations });
export const useEvaluation = (id: number) =>
  useQuery({ queryKey: ['evaluations', id], queryFn: () => getEvaluation(id) });
export const useHistoryOverview = () =>
  useQuery({ queryKey: ['history', 'overview'], queryFn: getHistoryOverview });
export const useHistoryRom = (filters: RomFilters = {}) =>
  useQuery({
    queryKey: ['history', 'rom', filters],
    queryFn: () => getHistoryRom(filters),
  });
export const useHistoryAssist = () =>
  useQuery({ queryKey: ['history', 'assist'], queryFn: getHistoryAssist });
export const useHistoryResistance = () =>
  useQuery({
    queryKey: ['history', 'resistance'],
    queryFn: getHistoryResistance,
  });
export const useSummaries = (
  filters: SummaryFilters = {},
  options: {
    /** Poll while the caller is waiting for a summary generated in the background. */
    refetchInterval?: (data: Summary[] | undefined) => number | false;
  } = {},
) =>
  useQuery({
    queryKey: ['summaries', filters],
    queryFn: () => getSummaries(filters),
    refetchInterval: options.refetchInterval
      ? (query) => options.refetchInterval!(query.state.data)
      : false,
  });
// Writes invalidate related lists and derived history. Live data stays outside Query.
function useWrite<T, V>(fn: (value: V) => Promise<T>, keys: string[]) {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await Promise.all(
        keys.map((key) => cache.invalidateQueries({ queryKey: [key] })),
      );
    },
  });
}
export const usePutProfile = () => useWrite(putProfile, ['profile']);
export const useCreateCalibration = () =>
  useWrite(createCalibration, ['calibrations']);
export const useCreateSession = () =>
  useWrite(createSession, ['sessions', 'history']);
export const useAddAttempt = () =>
  useWrite(addAttempt, ['sessions', 'history']);
export const useEndSession = () =>
  useWrite(endSession, ['sessions', 'history']);
export const useDeleteSession = () =>
  useWrite(deleteSession, ['sessions', 'history']);
export const useCreateEvaluation = () =>
  useWrite(createEvaluation, ['evaluations', 'history']);
export const useAddTranscript = () => useWrite(addTranscript, ['sessions']);
export const useCreateSummary = () => useWrite(createSummary, ['summaries']);
export const useCreateVoiceToken = () =>
  useMutation({ mutationFn: createVoiceToken });
export const useExportData = () => useMutation({ mutationFn: exportData });

export async function streamChat(
  messages: ChatMessage[],
  {
    signal,
    onEvent,
  }: { signal?: AbortSignal; onEvent: (event: ChatStreamEvent) => void },
): Promise<void> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      messages: messages
        .filter((m) => m.text.trim())
        .slice(-20)
        .map((m) => ({ ...m, text: m.text.slice(0, 4000) })),
    }),
    signal,
  });
  if (!response.ok) {
    const payload = (await response
      .json()
      .catch(() => null)) as ApiError | null;
    onEvent({
      type: 'error',
      code:
        payload?.error?.code === 'invalid_request'
          ? 'invalid_request'
          : 'chat_unavailable',
      message: payload?.error?.message ?? 'Chat unavailable',
    });
    return;
  }
  if (!response.body) throw new Error('Chat response has no stream');
  await parseChatEvents(response.body, onEvent, signal);
}

export const createChatVoiceToken = () =>
  request<ChatVoiceToken>('/chat/voice-token', body('POST'));
export const runChatTool = (
  name: ChatToolName,
  args: Record<string, unknown>,
) =>
  request<ChatToolResult>(
    `/chat/tools/${encodeURIComponent(name)}`,
    body('POST', { args }),
  );
