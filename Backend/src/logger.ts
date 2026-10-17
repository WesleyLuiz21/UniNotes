import pino from 'pino';

// Redaction is defence in depth: secrets should never be passed to the logger in the first place.
export function createLogger(level: string) {
  return pino({
    level,
    base: { service: 'uninotes-backend' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        'req.headers.cookie',
        'req.headers.authorization',
        'req.headers["x-csrf-token"]',
        'res.headers["set-cookie"]',
        '*.password',
        '*.currentPassword',
        '*.newPassword',
        '*.code',
        '*.token',
        '*.secret',
      ],
      censor: '[redacted]',
    },
  });
}

export type Logger = ReturnType<typeof createLogger>;
