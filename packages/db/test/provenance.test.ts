import { describe, expect, it } from "vitest";
import { gitSha, packageVersion, rpcHostFrom } from "../src/provenance.js";

describe("db/provenance", () => {
  it("gitSha: 40 znaków hex w repo, 'unknown' poza repo", () => {
    expect(gitSha()).toMatch(/^[0-9a-f]{40}$/);
    expect(gitSha("/")).toBe("unknown");
  });
  it("packageVersion: wersja z package.json pakietu (także z `exports` bez ./package.json)", () => {
    expect(packageVersion("drizzle-orm")).toMatch(/^\d+\.\d+\.\d+/);
    expect(packageVersion("@thi.ng/fuzzy")).toMatch(/^\d+\.\d+\.\d+/);
    expect(packageVersion("nie-ma-takiego-pakietu-xyz")).toBe("unknown");
  });
  it("rpcHostFrom: domena z pierwszą etykietą zamaskowaną (bez portu/ścieżki/poświadczeń)", () => {
    expect(rpcHostFrom("https://user:pw@rpc.example.org:8545/v1/abc")).toBe("*.example.org");
    expect(rpcHostFrom("https://eth-mainnet.g.alchemy.com/v2/key")).toBe("*.alchemy.com");
  });
  it("rpcHostFrom: domena bez subdomeny (dwie etykiety) zwracana bez zmian", () => {
    expect(rpcHostFrom("https://example.org")).toBe("example.org");
  });
  it("rpcHostFrom: 'self-hosted' dla literału IP (v4/v6) i hostów prywatnych", () => {
    expect(rpcHostFrom("http://203.0.113.5:4020/main/evm/1")).toBe("self-hosted"); // 203.0.113.0/24 = TEST-NET-3 (RFC 5737)
    expect(rpcHostFrom("http://127.0.0.1:8545")).toBe("self-hosted");
    expect(rpcHostFrom("http://192.168.1.5:8545")).toBe("self-hosted");
    expect(rpcHostFrom("http://[::1]:8545")).toBe("self-hosted");
    expect(rpcHostFrom("http://localhost:8545")).toBe("self-hosted");
    expect(rpcHostFrom("http://node.internal:8545")).toBe("self-hosted");
    expect(rpcHostFrom("http://my-eth-node:8545")).toBe("self-hosted");
  });
  it("rpcHostFrom: null dla pustego/niepoprawnego", () => {
    expect(rpcHostFrom("")).toBeNull();
    expect(rpcHostFrom(undefined)).toBeNull();
    expect(rpcHostFrom("nie-url")).toBeNull();
  });
});
