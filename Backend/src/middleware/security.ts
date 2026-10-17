import helmet from 'helmet';

/**
 * Security headers for API responses. The API never serves HTML, so the CSP is maximally strict.
 * The frontend's own CSP is set by the frontend web server (Frontend/Caddyfile).
 */
export const apiSecurityHeaders = () =>
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
        sandbox: [],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'no-referrer' },
    strictTransportSecurity: false, // set by the TLS-terminating proxy
    xFrameOptions: { action: 'deny' },
  });

/** Prevent caching of authenticated API responses by shared or browser caches. */
export const noStore = (
  _req: unknown,
  res: { setHeader: (k: string, v: string) => void },
  next: () => void,
) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
};
