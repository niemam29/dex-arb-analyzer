// Zakres bloków sterowany brushem wykresu spreadu (SpreadChart) — debounce 300 ms, żeby
// przeciąganie brusha nie odpalało requestu do `useSeries` na każdą klatkę; jeśli wybrany
// zakres to całe okno, zerujemy `range` (server dobiera `step` sam — `autoStep`).
import { useCallback, useEffect, useRef, useState } from "react";
import type { SeriesPointDto } from "@dex-arb/shared";

export type Range = { from: number | undefined; to: number | undefined };
const DEBOUNCE_MS = 300;

export function useBrushRange(win: { from_block: number | null; to_block: number | null } | undefined) {
  const [range, setRange] = useState<Range>({ from: undefined, to: undefined });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const setFromBrush = useCallback(
    (points: SeriesPointDto[], startIndex: number, endIndex: number) => {
      const first = points[startIndex];
      const last = points[endIndex];
      if (!first || !last) return;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const whole = first.from_block === win?.from_block && last.to_block === win?.to_block;
        setRange(whole ? { from: undefined, to: undefined } : { from: first.from_block, to: last.to_block });
      }, DEBOUNCE_MS);
    },
    [win?.from_block, win?.to_block],
  );

  const reset = useCallback(() => {
    clearTimeout(timer.current);
    setRange({ from: undefined, to: undefined });
  }, []);

  return { range, setFromBrush, reset };
}
