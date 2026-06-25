interface OpenAIEnv {
  OPENAI_API_KEY?: string;
}

const OPENAI_API_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_MODEL = 'gpt-4o-mini';

const readTextOutput = (data: any) => {
  if (typeof data?.output_text === 'string' && data.output_text) {
    return data.output_text;
  }

  if (Array.isArray(data?.output)) {
    for (const item of data.output) {
      if (!Array.isArray(item?.content)) continue;
      for (const content of item.content) {
        if (content?.type === 'output_text' && typeof content?.text === 'string') {
          return content.text;
        }
      }
    }
  }

  return '';
};

export const ensureOpenAiConfigured = (env: OpenAIEnv) => {
  if (!env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }
};

export const createOpenAiTextResponse = async (
  env: OpenAIEnv,
  input: Array<{ role: 'system' | 'user'; content: string }>,
  options?: {
    model?: string;
    temperature?: number;
  }
) => {
  ensureOpenAiConfigured(env);

  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: options?.model || DEFAULT_MODEL,
      input,
      temperature: options?.temperature ?? 0.2
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(data?.error?.message || 'OpenAI request failed'));
  }

  return readTextOutput(data);
};

export const createOpenAiStructuredResponse = async <T>(
  env: OpenAIEnv,
  input: Array<{ role: 'system' | 'user'; content: string }>,
  schemaName: string,
  schema: Record<string, unknown>,
  options?: {
    model?: string;
    temperature?: number;
  }
): Promise<T> => {
  ensureOpenAiConfigured(env);

  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: options?.model || DEFAULT_MODEL,
      input,
      temperature: options?.temperature ?? 0.1,
      text: {
        format: {
          type: 'json_schema',
          name: schemaName,
          strict: true,
          schema
        }
      }
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(data?.error?.message || 'OpenAI structured request failed'));
  }

  const text = readTextOutput(data);
  if (!text) {
    throw new Error('OpenAI did not return structured output text');
  }

  return JSON.parse(text) as T;
};
