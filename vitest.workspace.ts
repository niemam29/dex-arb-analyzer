import { defineWorkspace } from "vitest/config";

// Opcje pokrycia (coverage) są w vitest.config.ts (root) — workspace definiuje tylko projekty.
// Workspace Projects:
// - "node": wszystkie testy w packages/{analysis,api,core,db,ingest,shared,worker}/src|test/**
//   (testowanie czyste bez DOM). Environment=node, fileParallelism=false (dzielona BD postgres).
// - "web": packages/web/vitest.config.ts (jsdom, setupFiles, react plugin dla .tsx).
export default defineWorkspace([
  {
    test: {
      name: "node",
      include: [
        "packages/{analysis,api,core,db,ingest,shared,worker}/src/**/*.test.ts",
        "packages/{analysis,api,core,db,ingest,shared,worker}/test/**/*.test.ts",
      ],
      environment: "node",
      passWithNoTests: false,
      // Testy integracyjne dzielą jedną bazę Postgres, dlatego brak paralelizmu między plikami.
      fileParallelism: false,
    },
  },
  "packages/web",
]);
