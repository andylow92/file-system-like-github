/**
 * Optional, opt-in LLM synthesis for `GET /api/think`.
 *
 * The `think` endpoint is **offline by default**: it returns a cited answer kit
 * (numbered passages + gap analysis) that the calling agent — which is itself an
 * LLM — can compose into a final answer with zero API key. This module is the
 * only part that talks to a model, and only when a key is configured server-side.
 *
 * It mirrors the web app's OpenRouter wiring (`apps/web/src/openrouter/`) but
 * reads the key from the environment so the server never embeds a secret. With
 * no key set, `loadSynthesisConfig()` returns `null` and the endpoint simply
 * omits the synthesized `answer` — it never hard-fails.
 */
import type { AnswerKit } from '@repo/shared';

const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
/** Mirrors `DEFAULT_OPENROUTER_MODEL` in `apps/web/src/openrouter/storage.ts`. */
const DEFAULT_SYNTHESIS_MODEL = 'anthropic/claude-3.5-sonnet';

export interface SynthesisConfig {
  apiKey: string;
  model: string;
}

/**
 * Read server-side OpenRouter config from the environment. Returns `null` when
 * no `OPENROUTER_API_KEY` is set — the signal to stay fully offline. The model
 * is overridable via `OPENROUTER_MODEL`.
 */
export function loadSynthesisConfig(): SynthesisConfig | null {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }
  const model = process.env.OPENROUTER_MODEL?.trim() || DEFAULT_SYNTHESIS_MODEL;
  return { apiKey, model };
}

const SYSTEM_PROMPT = [
  'You answer questions strictly from the numbered source passages provided.',
  'Cite every claim with its source number in square brackets, e.g. [1] or [2][3].',
  'If the passages do not contain the answer, say so plainly instead of guessing.',
  'Be concise, and never invent sources or facts beyond the passages.',
].join(' ');

/** Render the kit's citations as a numbered, addressable source list. */
function renderSources(kit: AnswerKit): string {
  return kit.citations
    .map((citation) => {
      const address = [citation.path, citation.heading, citation.block ? `^${citation.block}` : '']
        .filter(Boolean)
        .join(' › ');
      const text = kit.passages[citation.n - 1]?.text ?? citation.excerpt;
      return `[${citation.n}] ${address}\n${text}`;
    })
    .join('\n\n');
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

/**
 * Synthesize a cited prose answer from the answer kit via OpenRouter. Throws on
 * a transport/HTTP error or an empty completion; callers should treat any
 * failure as "no synthesized answer" rather than failing the whole request.
 */
export async function synthesizeAnswer(params: {
  config: SynthesisConfig;
  kit: AnswerKit;
  signal?: AbortSignal;
}): Promise<string> {
  const { config, kit, signal } = params;

  const userContent = `Question: ${kit.query}\n\nSources:\n${renderSources(kit)}`;

  const response = await fetch(OPENROUTER_CHAT_URL, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
      'X-Title': 'fsbrain think',
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      temperature: 0.2,
    }),
  });

  let payload: ChatCompletionResponse | null = null;
  try {
    payload = (await response.json()) as ChatCompletionResponse;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(
      payload?.error?.message ?? `OpenRouter request failed with status ${response.status}`,
    );
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('OpenRouter returned an empty response.');
  }
  return content.trim();
}
