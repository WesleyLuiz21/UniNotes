/** Errors that are safe to show to clients. Anything else becomes a generic 500. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Authentication required') =>
  new ApiError(401, 'UNAUTHENTICATED', message);
export const forbidden = (message = 'Forbidden') => new ApiError(403, 'FORBIDDEN', message);
// Resources owned by other users are reported as "not found" to avoid leaking their existence.
export const notFound = (what = 'Resource') => new ApiError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (code: string, message: string, details?: unknown) =>
  new ApiError(409, code, message, details);
export const tooLarge = (message: string) => new ApiError(413, 'PAYLOAD_TOO_LARGE', message);
export const unsupported = (message: string) => new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', message);
