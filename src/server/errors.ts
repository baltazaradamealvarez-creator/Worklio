export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "INVALID_STATE"
  | "LIMIT_EXCEEDED"
  | "RATE_LIMITED";

/** Errors that are safe to show to the user. Anything else is reported as a generic failure. */
export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const forbidden = (message = "You don't have permission to do that.") => new AppError("FORBIDDEN", message);
export const notFound = (what = "Record") => new AppError("NOT_FOUND", `${what} not found.`);
export const invalidState = (message: string) => new AppError("INVALID_STATE", message);
export const conflict = (message: string) => new AppError("CONFLICT", message);
export const validation = (message: string, fieldErrors?: Record<string, string>) =>
  new AppError("VALIDATION", message, fieldErrors);
