// Wspólny stan "ładowanie"/"błąd" dla widoków — jeden formularz obu stanów, żeby nie powielać
// `<p>Ładowanie…</p>` / `<p>Błąd: …</p>` w każdym widoku. Błąd z `ApiError` pokazuje jego
// `.message` (komunikat z API); inne wyjątki `String(err)`. Role status/alert — czytniki ekranu
// ogłaszają zmianę bez fokusu.
import { ApiError } from "../api/client";

export type LoadingProps = Record<string, never>;

export function Loading() {
  return (
    <p className="status status--loading" role="status">
      Ładowanie…
    </p>
  );
}

export function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : String(err);
}

export type ErrorMessageProps = { error: unknown };

export function ErrorMessage({ error }: ErrorMessageProps) {
  return (
    <p className="status status--error" role="alert">
      Błąd: {errorMessage(error)}
    </p>
  );
}
