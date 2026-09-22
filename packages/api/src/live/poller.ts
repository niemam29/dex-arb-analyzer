// Poller panelu na żywo (spec §8): pojedyncze wywołanie `tick` w locie — kolejne planowane
// `setTimeout`-em dopiero po zakończeniu poprzedniego (nie `setInterval`, żeby wolne RPC nie
// nakładało próbek). Błędy logowane raz na zmianę stanu (nie co 15 s). Timeout pojedynczego
// żądania HTTP jest po stronie RpcClienta (AbortSignal.timeout w server.ts), więc `tick` zawsze
// kończy się w skończonym czasie. `stop()` wołane z hooka onClose Fastify.
import type { LiveTickResult } from "@dex-arb/shared";

export interface LivePollerLog {
  info(msg: string): void;
  warn(msg: string): void;
}

export interface LivePollerOptions {
  tick: () => Promise<LiveTickResult>;
  pollMs: number;
  log: LivePollerLog;
}

export interface LivePoller {
  stop(): void;
  readonly stopped: boolean;
  /** liczba rozpoczętych wywołań tick (diagnostyka/testy) */
  readonly ticks: number;
}

export function startLivePoller(opts: LivePollerOptions): LivePoller {
  let stopped = false;
  let ticks = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastOk: boolean | null = null;

  const run = async (): Promise<void> => {
    if (stopped) return;
    ticks++;
    let r: LiveTickResult;
    try {
      r = await opts.tick();
    } catch (e) {
      r = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    if (r.ok !== lastOk) {
      if (r.ok) opts.log.info(lastOk === null ? `live: próbkowanie działa (blok ${r.block})` : `live: próbkowanie wznowione (blok ${r.block})`);
      else opts.log.warn(`live: błąd próbkowania: ${r.error}`);
      lastOk = r.ok;
    }
    if (!stopped) timer = setTimeout(() => void run(), opts.pollMs);
  };

  void run();

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
    get stopped() {
      return stopped;
    },
    get ticks() {
      return ticks;
    },
  };
}
