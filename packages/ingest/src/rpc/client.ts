// Klient JSON-RPC (batch) z retry/backoffem i rotacją URL-i (eRPC -> publiczne RPC).
// Polityka retry (spec §4a pkt 5):
//   próba 1 i 2 na bieżącym URL, od 2. nieudanej próby rotacja na kolejny URL (cyklicznie),
//   opóźnienie rośnie wykładniczo (baseDelay·2^i, ograniczone maxDelay) + losowy jitter <=250ms,
//   po maxTries próbach rzucamy ostatni błąd.

export interface RpcRequest {
  method: string;
  params: unknown[];
}

export class RpcError extends Error {
  readonly status?: number;
  readonly code?: number;
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean, status?: number, code?: number) {
    super(message);
    this.name = "RpcError";
    this.retryable = retryable;
    if (status !== undefined) this.status = status;
    if (code !== undefined) this.code = code;
  }
}

export interface RpcClientOptions {
  urls: string[];
  fetchFn?: typeof fetch;
  maxTries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
}

// Kody błędów JSON-RPC traktowane jako przejściowe (limity/„too many requests”) — warto ponawiać.
// Inne błędy (np. -32602 zły parametr) są deterministyczne — ponowienie niczego nie zmieni.
const RETRYABLE_RPC_CODES = new Set([-32000, -32005, -32603]);

interface JsonRpcResponse {
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

export class RpcClient {
  private idx = 0;
  private nextId = 1;
  private readonly urls: string[];
  private readonly fetchFn: typeof fetch;
  private readonly maxTries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly log: (msg: string) => void;

  constructor(opts: RpcClientOptions) {
    if (opts.urls.length === 0) throw new Error("RpcClient: brak URL-i");
    this.urls = opts.urls;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.maxTries = opts.maxTries ?? 6;
    this.baseDelayMs = opts.baseDelayMs ?? 1000;
    this.maxDelayMs = opts.maxDelayMs ?? 30_000;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.log = opts.log ?? ((m) => console.error(m));
  }

  get currentUrl(): string {
    return this.urls[this.idx]!;
  }

  resetToPrimary(): void {
    this.idx = 0;
  }

  // Rotacja idempotentna względem URL-a, na którym nastąpiła porażka (usedIdx).
  // Przy współbieżnych batch() (mapConcurrent) każdy wywołujący ma własny licznik prób i
  // niezależnie decyduje o rotacji — bez tej strażniczej kontroli kilku wywołujących,
  // które oberwały porażkę na tym samym URL-u, rotowałoby po kolei, co przy 2 URL-ach
  // (parzysta liczba rotacji) cyklicznie wracałoby na zepsuty URL. Rotujemy tylko wtedy,
  // gdy nikt inny w międzyczasie już nie rotował z tego samego URL-a.
  private rotate(usedIdx: number): void {
    if (this.urls.length < 2) return;
    if (this.idx !== usedIdx) return;
    this.idx = (this.idx + 1) % this.urls.length;
    this.log(`  ! przełączam RPC -> ${this.currentUrl}`);
  }

  async call<T>(method: string, params: unknown[]): Promise<T> {
    const [r] = await this.batch<T>([{ method, params }]);
    return r as T;
  }

  async batch<T>(reqs: RpcRequest[]): Promise<T[]> {
    if (reqs.length === 0) return [];
    const first = reqs[0]!;
    const label = reqs.length === 1 ? first.method : `batch(${reqs.length}×${first.method})`;
    // Id-y przydzielamy raz, przed pętlą retry — to wciąż to samo logiczne zapytanie,
    // więc każda ponowiona próba musi wysłać te same id-y (serwer/mock odpowiada na nie).
    const payload = reqs.map((r) => ({ jsonrpc: "2.0", id: this.nextId++, method: r.method, params: r.params }));
    let lastErr: unknown;
    for (let i = 0; i < this.maxTries; i++) {
      // Zapamiętujemy URL użyty w tej próbie — potrzebny do idempotentnej rotacji (patrz rotate()).
      const usedIdx = this.idx;
      try {
        return await this.send<T>(payload);
      } catch (e) {
        lastErr = e;
        // Błędy JSON-RPC nieprzejściowe (np. zły parametr) przerywają natychmiast — ponowienie nic nie da.
        if (e instanceof RpcError && !e.retryable) throw e;
        const msg = e instanceof Error ? e.message.slice(0, 120) : String(e);
        // Logujemy URL zapamiętany dla tej próby (usedIdx), nie this.currentUrl — przy współbieżnych
        // batch() ktoś inny mógł już zrotować i this.currentUrl wskazywałby nieprawdziwy URL.
        this.log(`  ! błąd (${label}) na ${this.urls[usedIdx]}, próba ${i + 1}/${this.maxTries}: ${msg}`);
        if (i + 1 >= this.maxTries) break;
        // Pierwsza porażka: spróbuj jeszcze raz na tym samym URL-u. Od drugiej — rotacja.
        if (i >= 1) this.rotate(usedIdx);
        const delay = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** i) + Math.random() * 250;
        await this.sleep(delay);
      }
    }
    throw lastErr instanceof RpcError
      ? lastErr
      : new RpcError(`Nie udało się: ${label}: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`, true);
  }

  private async send<T>(payload: { jsonrpc: string; id: number; method: string; params: unknown[] }[]): Promise<T[]> {
    const body = JSON.stringify(payload.length === 1 ? payload[0] : payload);
    let res: Response;
    try {
      res = await this.fetchFn(this.currentUrl, { method: "POST", headers: { "content-type": "application/json" }, body });
    } catch (e) {
      throw new RpcError(`sieć: ${e instanceof Error ? e.message : String(e)}`, true);
    }
    // 429 i 5xx to zwykle przeciążenie/limity dostawcy RPC — przejściowe, warto ponowić/rotować.
    if (res.status === 429 || res.status >= 500) throw new RpcError(`HTTP ${res.status}`, true, res.status);
    if (!res.ok) throw new RpcError(`HTTP ${res.status}`, false, res.status);
    const json = (await res.json()) as JsonRpcResponse | JsonRpcResponse[];
    const arr = Array.isArray(json) ? json : [json];
    // Niekształtna odpowiedź (zła liczba elementów / brak odpowiedzi dla id) to błąd serwera/proxy,
    // nie przejściowe przeciążenie — ponowienie tego samego zapytania nie naprawi kształtu odpowiedzi.
    if (arr.length !== payload.length) throw new RpcError(`oczekiwano ${payload.length} odpowiedzi, otrzymano ${arr.length}`, false);
    const byId = new Map(arr.map((r) => [r.id, r]));
    return payload.map((p) => {
      const r = byId.get(p.id);
      if (!r) throw new RpcError(`brak odpowiedzi dla id=${p.id}`, false);
      if (r.error) throw new RpcError(`RPC ${r.error.code}: ${r.error.message}`, RETRYABLE_RPC_CODES.has(r.error.code), undefined, r.error.code);
      return r.result as T;
    });
  }
}
