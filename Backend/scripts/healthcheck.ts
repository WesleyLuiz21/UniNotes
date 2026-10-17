/** Container health check (no curl/wget in the runtime image). */
const port = process.env.PORT ?? '3000';
try {
  const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(4000) });
  process.exit(res.ok ? 0 : 1);
} catch {
  process.exit(1);
}
