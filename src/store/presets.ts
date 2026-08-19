/**
 * Provider defaults (DESIGN §4.4). Defaults only — every field stays editable
 * under "Advanced". WP0 owns this file.
 */
import type { LlmPreset, SttPreset } from '../types';

export interface Preset<T extends string> {
  id: T;
  label: string;
  baseUrl: string;
  model: string;
}

/**
 * OpenAI is the default because word-level timestamps need `whisper-1`
 * (`timestamp_granularities[]` is whisper-1 only) and because browser-direct
 * CORS is the verified path. Groq is offered and is far cheaper, but the Bring
 * copy must not *recommend* it until CORS is confirmed from the Pages origin
 * (DESIGN §8 SHOULD, §10.4).
 */
export const STT_PRESETS: Preset<SttPreset>[] = [
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'whisper-1' },
  { id: 'groq',   label: 'Groq',   baseUrl: 'https://api.groq.com/openai/v1', model: 'whisper-large-v3-turbo' },
  { id: 'custom', label: 'Custom', baseUrl: '', model: '' },
];

export const LLM_PRESETS: Preset<LlmPreset>[] = [
  { id: 'openai',      label: 'OpenAI',      baseUrl: 'https://api.openai.com/v1',     model: 'gpt-4o-mini' },
  { id: 'deepseek',    label: 'DeepSeek',    baseUrl: 'https://api.deepseek.com/v1',   model: 'deepseek-chat' },
  { id: 'openrouter',  label: 'OpenRouter',  baseUrl: 'https://openrouter.ai/api/v1',  model: 'openai/gpt-4o-mini' },
  { id: 'moonshot',    label: 'Moonshot',    baseUrl: 'https://api.moonshot.cn/v1',    model: 'kimi-k2-0711-preview' },
  { id: 'siliconflow', label: 'SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3' },
  { id: 'custom',      label: 'Custom',      baseUrl: '',                              model: '' },
];

/* Hard limits from the providers' own docs (DESIGN §4.6, fetched 2026-08-19). */
export const DIRECT_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
export const MAX_DURATION_SEC = 3 * 60 * 60;
export const MAX_FILE_BYTES = 400 * 1024 * 1024;

/** Nominal chunk length for the decode-and-chunk path (DESIGN §4.6 step 2). */
export const CHUNK_SEC = 600;
export const CHUNK_SAMPLE_RATE = 16000;
export const CHUNK_CONCURRENCY = 3;
export const CHUNK_RETRIES = 2;

/** Playback constants for the signature interaction (DESIGN §5). */
export const PRE_ROLL_SEC = 1.0;
export const PRE_ROLL_APPROX_SEC = 2.5;
export const POST_ROLL_SEC = 0.8;
export const SPEEDS = [1, 1.25, 1.5, 2] as const;
export const NUDGES = [-3, -1, 1, 3] as const;

/** Accepted input formats (DESIGN §4.3). */
export const ACCEPTED_EXT = ['mp3', 'm4a', 'mp4', 'wav', 'webm', 'ogg', 'flac', 'mpeg', 'mpga'] as const;
export const ACCEPT_ATTR = '.mp3,.m4a,.mp4,.wav,.webm,.ogg,.flac,.mpeg,.mpga,audio/*,video/mp4';
