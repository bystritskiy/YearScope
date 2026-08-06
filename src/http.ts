const USER_AGENT = 'YearScope/0.1 (personal dashboard)';

export class HttpError extends Error {
  status: number;
  url: string;

  constructor(message: string, status: number, url: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
  }
}

type FetchOptions = {
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
};

/**
 * Один общий фетчер на все источники: таймаут, повтор на сетевых сбоях и 5xx.
 * Повторять 4xx смысла нет — там ответ не изменится.
 */
async function request(url: string, options: FetchOptions = {}): Promise<Response> {
  const { timeoutMs = 20_000, retries = 2, headers = {} } = options;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { 'user-agent': USER_AGENT, ...headers },
      });
      if (response.status >= 500) {
        throw new HttpError(`HTTP ${response.status}`, response.status, url);
      }
      if (!response.ok) {
        throw new HttpError(`HTTP ${response.status}`, response.status, url);
      }
      return response;
    } catch (error) {
      lastError = error;
      const retriable = !(error instanceof HttpError) || error.status >= 500;
      if (!retriable || attempt === retries) break;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

export async function fetchJson<T = unknown>(url: string, options?: FetchOptions): Promise<T> {
  const response = await request(url, options);
  return (await response.json()) as T;
}

export async function fetchText(url: string, options?: FetchOptions): Promise<string> {
  const response = await request(url, options);
  return await response.text();
}

export async function postJson<T = unknown>(
  url: string,
  body: unknown,
  options: FetchOptions = {},
): Promise<T> {
  const { timeoutMs = 20_000, headers = {} } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'user-agent': USER_AGENT, 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new HttpError(`HTTP ${response.status}`, response.status, url);
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}
