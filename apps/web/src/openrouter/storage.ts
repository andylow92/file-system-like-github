export const DEFAULT_OPENROUTER_MODEL = 'anthropic/claude-3.5-sonnet';

export const SUGGESTED_OPENROUTER_MODELS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet (recommended)' },
  { id: 'anthropic/claude-3.5-haiku', label: 'Claude 3.5 Haiku (faster, cheaper)' },
  { id: 'openai/gpt-4o', label: 'GPT-4o' },
  { id: 'openai/gpt-4o-mini', label: 'GPT-4o mini' },
  { id: 'google/gemini-pro-1.5', label: 'Gemini Pro 1.5' },
  { id: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B Instruct' },
];

const API_KEY_STORAGE_KEY = 'openrouter:apiKey';
const MODEL_STORAGE_KEY = 'openrouter:model';

export function loadOpenRouterApiKey(): string {
  try {
    return localStorage.getItem(API_KEY_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveOpenRouterApiKey(value: string): void {
  try {
    if (value) {
      localStorage.setItem(API_KEY_STORAGE_KEY, value);
    } else {
      localStorage.removeItem(API_KEY_STORAGE_KEY);
    }
  } catch {
    // storage may be unavailable in some environments
  }
}

export function loadOpenRouterModel(): string {
  try {
    return localStorage.getItem(MODEL_STORAGE_KEY) || DEFAULT_OPENROUTER_MODEL;
  } catch {
    return DEFAULT_OPENROUTER_MODEL;
  }
}

export function saveOpenRouterModel(value: string): void {
  try {
    if (value) {
      localStorage.setItem(MODEL_STORAGE_KEY, value);
    } else {
      localStorage.removeItem(MODEL_STORAGE_KEY);
    }
  } catch {
    // storage may be unavailable in some environments
  }
}
