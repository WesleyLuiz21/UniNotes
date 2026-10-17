export const nowIso = () => new Date().toISOString();

export const isoAfter = (ms: number, from = Date.now()) => new Date(from + ms).toISOString();

/** Today's date as YYYY-MM-DD in UTC (server-side default only; the client sends local dates). */
export const todayUtc = () => new Date().toISOString().slice(0, 10);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Strict calendar-date validation for date-only strings. */
export function isValidDateOnly(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d && y >= 1900 && y <= 2200
  );
}
