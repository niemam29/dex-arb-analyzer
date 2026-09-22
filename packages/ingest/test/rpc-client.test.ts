import { describe, it, expect, vi } from "vitest";
import { RpcClient, RpcError } from "../src/rpc/client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
const noSleep = async () => {};

describe("RpcClient", () => {
  it("call zwraca result pojedynczego zapytania", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ jsonrpc: "2.0", id: 1, result: "0xbda790" }));
    const rpc = new RpcClient({ urls: ["http://primary"], fetchFn, sleep: noSleep });
    expect(await rpc.call<string>("eth_blockNumber", [])).toBe("0xbda790");
    const call = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(call[1].body as string);
    expect(body).toMatchObject({ jsonrpc: "2.0", method: "eth_blockNumber", params: [] });
  });

  it("batch wysyła tablicę i zwraca wyniki w kolejności zapytań (nawet gdy serwer odpowie w innej)", async () => {
    const fetchFn = vi.fn(async () => jsonResponse([
      { jsonrpc: "2.0", id: 2, result: "B" },
      { jsonrpc: "2.0", id: 1, result: "A" },
    ]));
    const rpc = new RpcClient({ urls: ["http://primary"], fetchFn, sleep: noSleep });
    const out = await rpc.batch<string>([{ method: "m", params: [1] }, { method: "m", params: [2] }]);
    expect(out).toEqual(["A", "B"]);
    const call = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(Array.isArray(JSON.parse(call[1].body as string))).toBe(true);
  });

  it("na 429 ponawia z backoffem, po drugiej porażce rotuje na fallback", async () => {
    const urls: string[] = [];
    const fetchFn = vi.fn(async (url: string) => {
      urls.push(url);
      if (urls.length <= 2) return jsonResponse({ error: "rate limited" }, 429);
      return jsonResponse({ jsonrpc: "2.0", id: 1, result: "ok" });
    });
    const sleep = vi.fn(async () => {});
    const rpc = new RpcClient({ urls: ["http://primary", "http://fallback"], fetchFn, sleep, baseDelayMs: 100 });
    expect(await rpc.call("m", [])).toBe("ok");
    expect(urls).toEqual(["http://primary", "http://primary", "http://fallback"]);
    expect(sleep).toHaveBeenCalledTimes(2);
    const secondSleepCall = sleep.mock.calls[1] as unknown as [number];
    expect(secondSleepCall[0]).toBeGreaterThanOrEqual(200); // 100·2^1
    expect(rpc.currentUrl).toBe("http://fallback");
    rpc.resetToPrimary();
    expect(rpc.currentUrl).toBe("http://primary");
  });

  it("błąd JSON-RPC -32602 nie jest ponawiany", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "invalid params" } }));
    const rpc = new RpcClient({ urls: ["http://primary"], fetchFn, sleep: noSleep });
    await expect(rpc.call("m", [])).rejects.toMatchObject({ code: -32602, retryable: false });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("po maxTries rzuca RpcError", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}, 503));
    const rpc = new RpcClient({ urls: ["http://a", "http://b"], fetchFn, sleep: noSleep, maxTries: 3 });
    await expect(rpc.call("m", [])).rejects.toBeInstanceOf(RpcError);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("rzuca po polsku, gdy lista URL-i jest pusta", () => {
    expect(() => new RpcClient({ urls: [] })).toThrow(/brak URL/i);
  });

  it("dwa równoległe call() failujące na tym samym URL-u rotują tylko raz (nie wracają na zepsuty URL)", async () => {
    const perUrlCalls: Record<string, number> = { "http://a": 0, "http://b": 0 };
    const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
      perUrlCalls[url] = (perUrlCalls[url] ?? 0) + 1;
      if (url === "http://a") return jsonResponse({}, 500); // A stale zepsute — retryable HTTP błąd
      const { id } = JSON.parse(init.body as string) as { id: number };
      return jsonResponse({ jsonrpc: "2.0", id, result: "ok" });
    });
    const rpc = new RpcClient({ urls: ["http://a", "http://b"], fetchFn, sleep: noSleep });
    const [r1, r2] = await Promise.all([rpc.call("m", []), rpc.call("m", [])]);
    expect(r1).toBe("ok");
    expect(r2).toBe("ok");
    // Obaj wywołujący failują dwa razy na A (współbieżnie), zanim ktokolwiek zdąży rotować —
    // bez idempotentnej rotacji drugi wywołujący rotowałby ponownie i zawróciłby na A.
    expect(perUrlCalls["http://a"]).toBe(4);
    expect(perUrlCalls["http://b"]).toBe(2);
    expect(rpc.currentUrl).toBe("http://b");
  });
});
