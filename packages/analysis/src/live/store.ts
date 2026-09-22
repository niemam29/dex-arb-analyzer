/**
 * Pamięć panelu na żywo (spec §5): ostatnia dobra próbka (`latest`) + ring-buffery historii —
 * globalny gazu (do percentyla G w M) i per para (swapy/blok, punkty wykresu). Trzymane wyłącznie
 * w procesie API; po restarcie puste (decyzja użytkownika). Błąd RPC (`fail`) nie kasuje
 * `latest` — tylko oznacza snapshot jako `stale` z komunikatem.
 */
import type { LivePairDto, LivePointDto, LiveSnapshotDto, LiveStoreLike } from "@dex-arb/shared";
import type { LiveSample } from "./sample.js";
import { liveFeatures, scoreLive, type LiveModels } from "./score.js";

export class RingBuffer<T> {
  private readonly buf: T[] = [];
  private head = 0;

  constructor(private readonly capacity: number) {
    if (!(capacity >= 1)) throw new Error("RingBuffer: pojemność musi być >= 1");
  }

  push(x: T): void {
    if (this.buf.length < this.capacity) {
      this.buf.push(x);
      return;
    }
    this.buf[this.head] = x;
    this.head = (this.head + 1) % this.capacity;
  }

  /** Od najstarszego do najnowszego. */
  toArray(): T[] {
    return [...this.buf.slice(this.head), ...this.buf.slice(0, this.head)];
  }

  get size(): number {
    return this.buf.length;
  }
}

const ERROR_MAX = 200;

interface Latest {
  at: string;
  block: number;
  ethUsd: number;
  gasGwei: number;
  consistent: boolean;
  pairs: LivePairDto[];
}

export class LiveStore implements LiveStoreLike {
  private latest: Latest | null = null;
  private stale = true;
  private error: string | null = null;
  private readonly gasHist: RingBuffer<number>;
  private readonly swapHist = new Map<number, RingBuffer<number>>();
  private readonly points = new Map<number, RingBuffer<LivePointDto>>();

  constructor(private readonly capacity: number) {
    this.gasHist = new RingBuffer<number>(capacity);
  }

  private ring<T>(map: Map<number, RingBuffer<T>>, pairId: number): RingBuffer<T> {
    let r = map.get(pairId);
    if (!r) {
      r = new RingBuffer<T>(this.capacity);
      map.set(pairId, r);
    }
    return r;
  }

  /** Dobra próbka: wpisuje do historii (bieżąca wliczona w percentyle), liczy cechy i oceny, czyści błąd. */
  record(sample: LiveSample, models: LiveModels): LiveSnapshotDto {
    this.gasHist.push(sample.gasGwei);
    const gasGwei = this.gasHist.toArray();
    const pairs: LivePairDto[] = sample.pairs.map((p) => {
      const swaps = this.ring(this.swapHist, p.pairId);
      swaps.push(p.swapsPerBlock);
      const f = liveFeatures(p, sample.gasGwei, { swapsPerBlock: swaps.toArray(), gasGwei });
      const scores = scoreLive(f, models);
      this.ring(this.points, p.pairId).push({ at: sample.at, block: sample.block, spread_pct: p.spreadPct, net_profit_usd: p.netProfitUsd, scores });
      return {
        pair_id: p.pairId,
        symbol: p.symbol,
        pool_a: { dex_name: p.poolA.dexName, price: p.poolA.price },
        pool_b: { dex_name: p.poolB.dexName, price: p.poolB.price },
        spread_pct: p.spreadPct,
        direction: p.direction,
        opt_trade_usd: p.optTradeUsd,
        gross_profit_usd: p.grossProfitUsd,
        net_profit_usd: p.netProfitUsd,
        tvl_min_usd: p.tvlMinUsd,
        features: { s: f.S, g: f.G, l: f.L, m: f.M },
        swaps_per_block: p.swapsPerBlock,
        scores,
      };
    });
    this.latest = { at: sample.at, block: sample.block, ethUsd: sample.ethUsd, gasGwei: sample.gasGwei, consistent: sample.consistent, pairs };
    this.stale = false;
    this.error = null;
    return this.snapshot();
  }

  fail(error: string): void {
    this.stale = true;
    this.error = error.slice(0, ERROR_MAX);
  }

  snapshot(): LiveSnapshotDto {
    const history: Record<string, LivePointDto[]> = {};
    for (const [pairId, ring] of this.points) history[String(pairId)] = ring.toArray();
    const l = this.latest;
    return {
      at: l?.at ?? null,
      block: l?.block ?? null,
      eth_usd: l?.ethUsd ?? null,
      gas_gwei: l?.gasGwei ?? null,
      stale: this.stale,
      consistent: l?.consistent ?? true,
      error: this.error,
      enabled: true,
      pairs: l?.pairs ?? [],
      history,
    };
  }
}
