/**
 * Typed HTTP errors for the Sales API. Every expected failure is an HttpError so the dispatcher can turn it
 * into a stable machine-readable response (`{ error, code, details? }`). Unexpected errors become a generic 500
 * and are never echoed to the client.
 */
export interface FieldIssue {
  path: string;
  message: string;
}

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, "bad_request", message, details);
export const unauthorized = (message = "Authentication required") => new HttpError(401, "unauthorized", message);
export const forbidden = (message = "You do not have permission to do that", code = "forbidden") => new HttpError(403, code, message);
export const notFound = (what = "Record") => new HttpError(404, "not_found", `${what} not found`);
export const conflict = (message: string, code = "conflict", details?: unknown) => new HttpError(409, code, message, details);
export const unprocessable = (message: string, code = "unprocessable", details?: unknown) => new HttpError(422, code, message, details);
export const validationFailed = (issues: FieldIssue[]) =>
  new HttpError(422, "validation_failed", issues.length === 1 ? issues[0]!.message : `${issues.length} fields are invalid`, { issues });
export const tooManyRequests = (message = "Too many requests") => new HttpError(429, "rate_limited", message);
export const unavailable = (message: string, code = "integration_unavailable") => new HttpError(503, code, message);

export function isHttpError(e: unknown): e is HttpError {
  return e instanceof HttpError;
}
