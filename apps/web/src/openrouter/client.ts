const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

const FIX_FORMAT_SYSTEM_PROMPT = [
  'You are a markdown formatter.',
  'Reformat the markdown you receive so it is clean, consistent, and pleasant to read.',
  'Preserve every piece of information and every link; do not invent new content or remove sections.',
  'Use proper heading levels, blank lines between blocks, fenced code blocks with language hints when obvious, tight lists, and consistent emphasis.',
  'Fix obvious typos in markdown syntax but never rewrite the prose meaning.',
  'Return only the resulting markdown. No commentary, no surrounding code fence, no explanations.',
].join(' ');

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string; code?: string | number };
}

export class OpenRouterError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'OpenRouterError';
    this.status = status;
  }
}

export async function fixMarkdownFormat(params: {
  apiKey: string;
  model: string;
  markdown: string;
  signal?: AbortSignal;
}): Promise<string> {
  const { apiKey, model, markdown, signal } = params;

  if (!apiKey) {
    throw new OpenRouterError('OpenRouter API key is missing. Add one in settings.');
  }
  if (!model) {
    throw new OpenRouterError('No model selected. Pick a model in settings.');
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: FIX_FORMAT_SYSTEM_PROMPT },
    { role: 'user', content: markdown },
  ];

  let response: Response;
  try {
    response = await fetch(OPENROUTER_CHAT_URL, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : '',
        'X-Title': 'File-System-Like GitHub Markdown',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.2,
      }),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }
    throw new OpenRouterError(
      error instanceof Error ? error.message : 'Network request to OpenRouter failed.',
    );
  }

  let payload: ChatCompletionResponse | null = null;
  try {
    payload = (await response.json()) as ChatCompletionResponse;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message =
      payload?.error?.message ?? `OpenRouter request failed with status ${response.status}.`;
    throw new OpenRouterError(message, response.status);
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new OpenRouterError('OpenRouter returned an empty response.');
  }

  return stripWrappingCodeFence(content);
}

function stripWrappingCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:markdown|md)?\n([\s\S]*?)\n```$/i);
  if (fenceMatch) {
    return fenceMatch[1];
  }
  return text;
}
