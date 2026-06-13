/**
 * Minimal HTTP client over Node's global fetch, with a cookie jar so session
 * auth flows (login -> /auth/me) work across requests. No third-party dep
 * (supertest pulls a peer-dep conflict in this workspace).
 *
 * `stream()` returns the raw Response so SSE tests can read response.body.
 */
export interface JsonResponse<T = any> {
  status: number;
  headers: Headers;
  body: T;
  text: string;
}

export class HttpClient {
  private cookies = new Map<string, string>();

  constructor(private readonly baseUrl: string) {}

  private cookieHeader(): string {
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  private captureCookies(res: Response) {
    // Node fetch exposes combined set-cookie via getSetCookie() (undici).
    const setCookies = (res.headers as any).getSetCookie?.() as string[] | undefined;
    const list = setCookies ?? (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")!] : []);
    for (const c of list) {
      const [pair] = c.split(";");
      const idx = pair.indexOf("=");
      if (idx > 0) this.cookies.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
  }

  /** Manually inject a cookie (e.g. to forge a session for negative tests). */
  setCookie(name: string, value: string) {
    this.cookies.set(name, value);
  }

  /** Read a cookie value from the jar (e.g. to assert the session id rotated). */
  getCookie(name: string): string | undefined {
    return this.cookies.get(name);
  }

  clearCookies() {
    this.cookies.clear();
  }

  async request<T = any>(
    method: string,
    path: string,
    opts: { body?: unknown; headers?: Record<string, string>; raw?: boolean } = {},
  ): Promise<JsonResponse<T>> {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    const cookie = this.cookieHeader();
    if (cookie) headers["cookie"] = cookie;
    let body: BodyInit | undefined;
    if (opts.body !== undefined) {
      if (opts.raw) {
        body = opts.body as BodyInit;
      } else {
        headers["content-type"] = "application/json";
        body = JSON.stringify(opts.body);
      }
    }
    const res = await fetch(this.baseUrl + path, { method, headers, body });
    this.captureCookies(res);
    const text = await res.text();
    let parsed: any = text;
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      try {
        parsed = JSON.parse(text);
      } catch {
        /* leave as text */
      }
    }
    return { status: res.status, headers: res.headers, body: parsed, text };
  }

  get<T = any>(path: string, headers?: Record<string, string>) {
    return this.request<T>("GET", path, { headers });
  }
  post<T = any>(path: string, body?: unknown, headers?: Record<string, string>) {
    return this.request<T>("POST", path, { body, headers });
  }
  put<T = any>(path: string, body?: unknown, headers?: Record<string, string>) {
    return this.request<T>("PUT", path, { body, headers });
  }
  patch<T = any>(path: string, body?: unknown, headers?: Record<string, string>) {
    return this.request<T>("PATCH", path, { body, headers });
  }
  delete<T = any>(path: string, body?: unknown, headers?: Record<string, string>) {
    return this.request<T>("DELETE", path, { body, headers });
  }

  /** Open a raw streaming response (for SSE). Caller reads res.body. */
  async stream(
    method: string,
    path: string,
    opts: { body?: unknown; headers?: Record<string, string>; signal?: AbortSignal } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    const cookie = this.cookieHeader();
    if (cookie) headers["cookie"] = cookie;
    let body: BodyInit | undefined;
    if (opts.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(opts.body);
    }
    return fetch(this.baseUrl + path, { method, headers, body, signal: opts.signal });
  }
}
