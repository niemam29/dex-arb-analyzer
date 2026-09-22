// Dane seedowe konfiguracji — JEDYNY seed w monorepo: 2 DEX-y, 5 tokenów, 4 pary logiczne, 8 pul,
// 4 okna analizy. Nazwy dex-ów (uniswap-v2/sushiswap), nazwy okien (2021-05 krach itd.) i adresy
// (małe litery, char(42) — patrz docs/konwencje.md „Decyzje") muszą pozostać stabilne, żeby ponowne
// uruchomienie na tej samej bazie aktualizowało istniejące wiersze (ON CONFLICT ... DO UPDATE po
// naturalnym kluczu), a nie tworzyło duplikatów pod inną nazwą/wielkością liter.
import { Interface, getAddress } from "ethers";

export const DEXES = [
  { name: "uniswap-v2", factory: "0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f", feeBps: 30 },
  { name: "sushiswap", factory: "0xc0aee478e3658e2610c5f7a4a2e1777ce9e4f2ac", feeBps: 30 },
] as const;

export const TOKENS = [
  { address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", symbol: "WETH", decimals: 18 },
  { address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", symbol: "USDC", decimals: 6 },
  { address: "0xdac17f958d2ee523a2206206994597c13d831ec7", symbol: "USDT", decimals: 6 },
  { address: "0x6b175474e89094c44da98b954eedeac495271d0f", symbol: "DAI", decimals: 18 },
  // Uwaga: adres źródłowy WBTC ("...c193bc2c3b9") był błędny (nie tylko checksum — inne bajty; pod
  // tym adresem nie ma kodu kontraktu). Poprawny adres WBTC potwierdzony on-chain (--verify):
  // token0() obu pul WBTC/WETH (Uniswap V2 i Sushiswap) zwraca "0x2260fac5...bc2c599".
  { address: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599", symbol: "WBTC", decimals: 8 },
] as const;

export const PAIRS = [
  { symbol: "WETH/USDC", base: "WETH", quote: "USDC" },
  { symbol: "WETH/USDT", base: "WETH", quote: "USDT" },
  { symbol: "WETH/DAI", base: "WETH", quote: "DAI" },
  { symbol: "WBTC/WETH", base: "WBTC", quote: "WETH" },
] as const;

export interface PoolSeed {
  dex: string;
  pair: string;
  address: string | null;
  verified: boolean;
}

/**
 * Adresy oczekiwane; null = nieznany (seed z --verify pobierze z factory.getPair). verified=true
 * oznacza adres potwierdzony on-chain. Po weryfikacji przez --verify runSeed wypisuje "OK"
 * (adres zgodny z tu wpisanym) lub "NEW" (adres potwierdzony po raz pierwszy).
 */
export const POOLS: PoolSeed[] = [
  { dex: "uniswap-v2", pair: "WETH/USDC", address: "0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc", verified: true },
  { dex: "sushiswap", pair: "WETH/USDC", address: "0x397ff1542f962076d0bfe58ea045ffa2d347aca0", verified: true },
  { dex: "uniswap-v2", pair: "WETH/USDT", address: "0x0d4a11d5eeaac28ec3f61d100daf4d40471f1852", verified: true },
  { dex: "sushiswap", pair: "WETH/USDT", address: "0x06da0fd433c1a5d7a4faa01111c044910a184553", verified: true },
  { dex: "uniswap-v2", pair: "WETH/DAI", address: "0xa478c2975ab1ea89e8196811f51a7b7ade33eb11", verified: true },
  { dex: "sushiswap", pair: "WETH/DAI", address: "0xc3d03e4f041fd4cd388c549ee2a29a9e5075882f", verified: true },
  { dex: "uniswap-v2", pair: "WBTC/WETH", address: "0xbb2b8038a1640196fbe3e38816f3e67cba72d940", verified: true },
  { dex: "sushiswap", pair: "WBTC/WETH", address: "0xceff51756c56ceffca006cd410b03ffc46dd3a58", verified: true },
];

/**
 * Okna [from, to) w UTC (unix sekundy) — cztery okna analizy (krach 2021-05, ATH 2021-11, Luna
 * 2022-05, FTX 2022-11). `runSeed` aktualizuje istniejące wiersze po nazwie (ON CONFLICT ...
 * DO UPDATE), więc powtórne uruchomienie na tej samej bazie nie tworzy duplikatów pod innymi
 * datami.
 *
 * OCZEKIWANE granice bloków (pierwszy blok o ts ≥ from, ostatni o ts < to), wyznaczone binary
 * searchem po timestampach na archiwalnym RPC podczas pełnej macierzy 4 pary × 4 okna
 * (27.08.2026) i utrwalone tutaj, żeby wynik nie zależał od węzła RPC. `db:seed --verify`
 * porównuje je ponownie z RPC i ostrzega przy rozbieżności (`resolveWindowBlocks`).
 */
export const WINDOWS = [
  { name: "2021-05 krach", fromTs: Date.UTC(2021, 4, 14) / 1000, toTs: Date.UTC(2021, 4, 26) / 1000, fromBlock: 12_429_199, toBlock: 12_506_592 },
  { name: "2021-11 ATH", fromTs: Date.UTC(2021, 10, 5) / 1000, toTs: Date.UTC(2021, 10, 19) / 1000, fromBlock: 13_553_257, toBlock: 13_642_393 },
  { name: "2022-05 Luna", fromTs: Date.UTC(2022, 4, 5) / 1000, toTs: Date.UTC(2022, 4, 19) / 1000, fromBlock: 14_713_964, toBlock: 14_801_795 },
  { name: "2022-11 FTX", fromTs: Date.UTC(2022, 10, 5) / 1000, toTs: Date.UTC(2022, 10, 19) / 1000, fromBlock: 15_900_096, toBlock: 16_000_337 },
] as const;

export const FACTORY_IFACE = new Interface(["function getPair(address,address) view returns (address)"]);
export const PAIR_ERC20_IFACE = new Interface([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
]);

export const getPairCalldata = (a: string, b: string): string => FACTORY_IFACE.encodeFunctionData("getPair", [a, b]);
// getAddress() zwraca zawsze checksum EIP-55 (mieszane litery) — do zapisu w bazie (konwencja
// „małe litery", docs/konwencje.md „Decyzje") wywołujący normalizuje wynik przez .toLowerCase().
export const decodeAddress = (word: string): string => getAddress("0x" + word.slice(-40));
