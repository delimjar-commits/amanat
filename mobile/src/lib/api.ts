// Small JSON client for the Amanat server. One instance for the user token, one for
// the admin token. Wakes a sleeping free Render server instead of failing.
export class ApiError extends Error {
  status: number;
  code?: string;
  data?: Record<string, unknown>;
  constructor(status: number, message: string, code?: string, data?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

export type ServerStatus = 'ok' | 'waking' | 'down';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function pingServer(root: string, timeoutMs = 15000): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`${root}/health`, { headers: { accept: 'application/json' } }, timeoutMs);
    if (!res.ok) return false;
    const data = (await res.json().catch(() => null)) as { ok?: boolean } | null;
    return Boolean(data?.ok);
  } catch {
    return false;
  }
}

const waking = new Map<string, Promise<boolean>>();
export function wakeServer(root: string, maxMs = 150000): Promise<boolean> {
  const running = waking.get(root);
  if (running) return running;
  const p = (async () => {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      if (await pingServer(root)) return true;
      await sleep(2500);
    }
    return false;
  })().finally(() => waking.delete(root));
  waking.set(root, p);
  return p;
}

type Attempt = { wake: true } | { wake: false; res: Response; data: any };

export function createApi(root: string, getToken: () => string | null, onUnauthorized: () => void, onStatus?: (s: ServerStatus) => void) {
  async function once(method: string, path: string, body?: unknown): Promise<Attempt> {
    const token = getToken();
    let res: Response;
    try {
      res = await fetchWithTimeout(
        root + path,
        {
          method,
          headers: { accept: 'application/json', 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
          body: body === undefined ? undefined : JSON.stringify(body),
        },
        60000,
      );
    } catch {
      return { wake: true };
    }
    if (res.status === 502 || res.status === 503 || res.status === 504) return { wake: true };
    const json = (res.headers.get('content-type') || '').includes('application/json');
    if (!json && res.ok) return { wake: true };
    return { wake: false, res, data: await res.json().catch(() => ({})) };
  }

  async function req<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    let r = await once(method, path, body);
    if (r.wake) {
      onStatus?.('waking');
      const up = await wakeServer(root);
      onStatus?.(up ? 'ok' : 'down');
      if (!up) throw new ApiError(0, 'The server is not answering. Check your connection and try again.');
      r = await once(method, path, body);
      if (r.wake) throw new ApiError(0, 'The server is not answering. Try again in a minute.');
    }
    const { res, data } = r;
    if (res.status === 401) {
      onUnauthorized();
      throw new ApiError(401, data?.error || 'Please sign in again.', data?.code, data);
    }
    if (!res.ok) throw new ApiError(res.status, data?.error || `Something went wrong (${res.status}).`, data?.code, data);
    return data as T;
  }

  return {
    root,
    get: <T = any>(p: string) => req<T>('GET', p),
    post: <T = any>(p: string, b: unknown = {}) => req<T>('POST', p, b),
    put: <T = any>(p: string, b: unknown = {}) => req<T>('PUT', p, b),
    patch: <T = any>(p: string, b: unknown = {}) => req<T>('PATCH', p, b),
    del: <T = any>(p: string) => req<T>('DELETE', p),
    url: (p: string) => (p.startsWith('http') ? p : root + p),
  };
}

export type Api = ReturnType<typeof createApi>;

export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
