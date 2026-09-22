// Poller panelu na żywo (spec §8): pierwsza próbka natychmiast, kolejna dopiero pollMs PO
// zakończeniu poprzedniej (brak nakładania), log tylko przy zmianie ok/błąd, stop() przerywa.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { LiveTickResult } from "@dex-arb/shared";
import { startLivePoller } from "../src/live/poller.js";

const logger = () => ({ info: vi.fn<(m: string) => void>(), warn: vi.fn<(m: string) => void>() });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("startLivePoller", () => {
  it("tick natychmiast, kolejny po pollMs liczonym od zakończenia poprzedniego", async () => {
    let resolveTick: ((r: LiveTickResult) => void) | null = null;
    const tick = vi.fn(() => new Promise<LiveTickResult>((res) => { resolveTick = res; }));
    const p = startLivePoller({ tick, pollMs: 15_000, log: logger() });
    expect(tick).toHaveBeenCalledTimes(1);
    // próbka trwa 20 s — w tym czasie NIE startuje kolejna
    await vi.advanceTimersByTimeAsync(20_000);
    expect(tick).toHaveBeenCalledTimes(1);
    resolveTick!({ ok: true, block: 1 });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(tick).toHaveBeenCalledTimes(2);
    expect(p.ticks).toBe(2);
    p.stop();
  });

  it("loguje raz na zmianę stanu: ok -> warn przy pierwszym błędzie -> info po powrocie", async () => {
    const results: LiveTickResult[] = [
      { ok: true, block: 1 }, { ok: true, block: 2 }, { ok: false, error: "HTTP 429" }, { ok: false, error: "HTTP 429" }, { ok: true, block: 5 },
    ];
    let i = 0;
    const tick = vi.fn(async () => results[Math.min(i++, results.length - 1)]!);
    const log = logger();
    const p = startLivePoller({ tick, pollMs: 1_000, log });
    await vi.advanceTimersByTimeAsync(4_500);
    expect(tick).toHaveBeenCalledTimes(5);
    expect(log.info.mock.calls.map((c) => c[0])).toEqual(["live: próbkowanie działa (blok 1)", "live: próbkowanie wznowione (blok 5)"]);
    expect(log.warn.mock.calls.map((c) => c[0])).toEqual(["live: błąd próbkowania: HTTP 429"]);
    p.stop();
  });

  it("wyjątek z tick traktowany jak błąd (warn), poller nie umiera", async () => {
    const tick = vi.fn<() => Promise<LiveTickResult>>().mockRejectedValueOnce(new Error("boom")).mockResolvedValue({ ok: true, block: 9 });
    const log = logger();
    const p = startLivePoller({ tick, pollMs: 1_000, log });
    await vi.advanceTimersByTimeAsync(1_500);
    expect(tick).toHaveBeenCalledTimes(2);
    expect(log.warn).toHaveBeenCalledWith("live: błąd próbkowania: boom");
    expect(log.info).toHaveBeenCalledWith("live: próbkowanie wznowione (blok 9)");
    p.stop();
  });

  it("stop(): brak kolejnych wywołań, także gdy stop przyszedł w trakcie próbki", async () => {
    let resolveTick: ((r: LiveTickResult) => void) | null = null;
    const tick = vi.fn(() => new Promise<LiveTickResult>((res) => { resolveTick = res; }));
    const p = startLivePoller({ tick, pollMs: 1_000, log: logger() });
    p.stop();
    expect(p.stopped).toBe(true);
    resolveTick!({ ok: true, block: 1 });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(tick).toHaveBeenCalledTimes(1);
  });
});
