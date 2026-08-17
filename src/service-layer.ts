import type { B1Document } from './types.js';

export type B1Credentials = { companyDb: string; userName: string; password: string };
export type B1ServiceLayerOptions = {
  baseUrl: string;
  credentials: B1Credentials;
  fetch?: typeof globalThis.fetch;
  retries?: number;
  retryBaseMs?: number;
};

export class B1ServiceLayerError extends Error {
  constructor(public readonly status: number, message: string, public readonly retryable: boolean) {
    super(message);
    this.name = 'B1ServiceLayerError';
  }
}

function normalizeBaseUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new TypeError('SAP Business One Service Layer requiere HTTPS salvo en simuladores locales.');
  }
  const pathname = url.pathname.replace(/\/$/, '');
  if (!pathname.endsWith('/b1s/v2')) throw new TypeError('La URL debe terminar en /b1s/v2 (OData v4).');
  return `${url.origin}${pathname}`;
}

async function responseMessage(response: Response) {
  const body = await response.json().catch(() => undefined) as { error?: { message?: string | { value?: string } } } | undefined;
  const message = body?.error?.message;
  return typeof message === 'string' ? message : message?.value ?? `SAP Business One HTTP ${response.status}`;
}

export class B1ServiceLayerClient {
  readonly baseUrl: string;
  private readonly fetcher: typeof globalThis.fetch;
  private session?: { cookie: string; expiresAt: number };
  private readonly retries: number;
  private readonly retryBaseMs: number;

  constructor(private readonly options: B1ServiceLayerOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.retries = Math.max(0, Math.min(options.retries ?? 2, 5));
    this.retryBaseMs = Math.max(0, options.retryBaseMs ?? 100);
  }

  private async login() {
    const response = await this.fetcher(`${this.baseUrl}/Login`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ CompanyDB: this.options.credentials.companyDb, UserName: this.options.credentials.userName, Password: this.options.credentials.password }),
    });
    const body = await response.json().catch(() => ({})) as { SessionId?: string; SessionTimeout?: number };
    if (!response.ok || !body.SessionId) throw new B1ServiceLayerError(response.status, await responseMessage(response), response.status >= 500);
    const route = response.headers.get('set-cookie')?.match(/ROUTEID=([^;]+)/)?.[1];
    this.session = {
      cookie: `B1SESSION=${body.SessionId}${route ? `; ROUTEID=${route}` : ''}`,
      expiresAt: Date.now() + Math.max(1, body.SessionTimeout ?? 30) * 60_000,
    };
    return this.session.cookie;
  }

  private async cookie(force = false) {
    if (!force && this.session && this.session.expiresAt > Date.now() + 30_000) return this.session.cookie;
    return this.login();
  }

  private async request(path: string, init: RequestInit = {}) {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      const response = await this.fetcher(`${this.baseUrl}${path}`, {
        ...init,
        headers: { Accept: 'application/json', Cookie: await this.cookie(), ...init.headers },
      });
      if (response.status === 401 && attempt === 0) {
        this.session = undefined;
        await this.cookie(true);
        continue;
      }
      if (response.ok) return response;
      const error = new B1ServiceLayerError(response.status, await responseMessage(response), response.status === 429 || response.status >= 500);
      if (!error.retryable || attempt === this.retries) throw error;
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, this.retryBaseMs * (2 ** attempt)));
    }
    throw lastError instanceof Error ? lastError : new B1ServiceLayerError(0, 'Service Layer no disponible.', true);
  }

  async getDocument(entity: 'DeliveryNotes' | 'PurchaseDeliveryNotes', docEntry: number) {
    if (!Number.isSafeInteger(docEntry) || docEntry <= 0) throw new TypeError('DocEntry debe ser un entero positivo.');
    const response = await this.request(`/${entity}(${docEntry})`);
    return response.json() as Promise<B1Document>;
  }

  async patchDelivery(docEntry: number, fields: Record<string, string>) {
    if (!Object.keys(fields).length) return;
    await this.request(`/DeliveryNotes(${docEntry})`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', 'If-Match': '*' }, body: JSON.stringify(fields),
    });
  }
}
