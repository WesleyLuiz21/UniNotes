import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import type { Logger } from '../logger.js';
import { ApiError } from '../lib/errors.js';

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } });
}

/** Central error handler: known errors are mapped; unknown ones are logged and hidden. */
export function errorHandler(logger: Logger) {
  return (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    let status = 500;
    let body: { code: string; message: string; details?: unknown } = {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    };

    if (err instanceof ApiError) {
      status = err.status;
      body = {
        code: err.code,
        message: err.message,
        ...(err.details === undefined ? {} : { details: err.details }),
      };
    } else if (err instanceof multer.MulterError) {
      status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      body = {
        code: err.code === 'LIMIT_FILE_SIZE' ? 'PAYLOAD_TOO_LARGE' : 'BAD_UPLOAD',
        message: err.code === 'LIMIT_FILE_SIZE' ? 'File is too large' : 'Invalid upload',
      };
    } else if (isHttpError(err)) {
      // body-parser errors (malformed JSON, body too large)
      status = err.status;
      body =
        err.type === 'entity.too.large'
          ? { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' }
          : { code: 'BAD_REQUEST', message: 'Malformed request body' };
    }

    if (status >= 500) {
      logger.error({ err, method: req.method, url: req.originalUrl }, 'Unhandled error');
    }
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.status(status).json({ error: body });
  };
}

function isHttpError(err: unknown): err is { status: number; type?: string } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'status' in err &&
    typeof (err as { status: unknown }).status === 'number' &&
    (err as { status: number }).status >= 400 &&
    (err as { status: number }).status < 500
  );
}
