import { defineConfig } from "vitest/config";

// Pokrycie liczone dla całego workspace (projekty w vitest.workspace.ts). Progi tylko dla pakietów
// z logiką domenową (`core`, `analysis`); `live/**` (panel na żywo, osobny tor prac) i pliki
// narzędziowe wyłączone z pomiaru.
export default defineConfig({
  test: {
    // Testy integracyjne (packages/analysis) dzielą jedną bazę Postgres i muszą wykonywać się
    // sekwencyjnie. `fileParallelism: false` zadeklarowane na projekcie "node" w
    // vitest.workspace.ts NIE wystarcza: zweryfikowano empirycznie (2× `npx vitest run
    // --coverage` z tą linią usuniętą z ROOT configu → oba przebiegi kończą się ok. 25 plików
    // testowych failed na deadlock/FK-violation na współdzielonej bazie; 2× z linią obecną →
    // oba przebiegi 135 passed/0 failed; efekt niezależny od `--coverage`, ten sam wynik z
    // samym `vitest run`). Usunięcie tej linii przywraca wyścigi o bazę.
    fileParallelism: false,
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**"],
      exclude: [
        "**/*.test.ts",
        "**/*.test.tsx",
        "packages/*/src/live/**",
        "packages/api/src/routes/live.ts",
        "packages/web/src/ds.ts",
        "packages/web/src/main.tsx",
        "packages/db/src/migrate.ts",
        "packages/*/src/index.ts",
        "packages/analysis/src/cli.ts",
        "packages/api/src/server.ts",
        "packages/worker/src/index.ts",
      ],
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage",
      thresholds: {
        "packages/core/src/**": { lines: 80 },
        "packages/analysis/src/**": { lines: 80 },
      },
    },
  },
});
