// Parametry baseline'u skalibrowanego (`scoring_models.params` dla kind='baseline_v2', dołączane
// przez GET /models) — kilka interpretowalnych liczb; kształt wg `BaselineV2Params` w
// `@dex-arb/core` (web nie zależy od core, więc odczyt defensywny z `Record<string, unknown>`).
const num = (v: unknown): string => (typeof v === "number" && Number.isFinite(v) ? v.toLocaleString("pl-PL", { maximumFractionDigits: 3 }) : "—");
const list = (v: unknown): string => (Array.isArray(v) && v.length > 0 ? v.map(num).join(" / ") : "—");

export type BaselineV2ParamsProps = { params: Record<string, unknown> };

export function BaselineV2Params({ params }: BaselineV2ParamsProps) {
  return (
    <dl
      className="detail baseline-v2-params"
      aria-label="Parametry baseline v2"
      title="Parametry wybrane z siatki kalibracyjnej. Metryki 'calibration' w scoring_models.metrics są in-sample (maksimum po siatce na oknach kalibracyjnych) — tylko 'holdout' (okna testowe) jest out-of-sample."
    >
      <dt>Gaz [jedn.]</dt>
      <dd>{num(params.gasUnits)}</dd>
      <dt>Mnożnik ceny gazu</dt>
      <dd>{num(params.gasPriceFactor)}</dd>
      <dt>Gaz referencyjny arb. [jedn.]</dt>
      <dd>{num(params.arbGasRef)}</dd>
      <dt>Waga rangi optTrade</dt>
      <dd>{num(params.weightOptTrade)}</dd>
      <dt>Próg (v)</dt>
      <dd>{num(params.threshold)}</dd>
      <dt>Skala net2 [USD]</dt>
      <dd>{num(params.scale)}</dd>
      <dt>Kwantyle optTrade</dt>
      <dd>{list(params.optTradeQuantiles)}</dd>
    </dl>
  );
}
