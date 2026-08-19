/**
 * Lifelog's error taxonomy.
 *
 * Two audiences, two messages. `message` is written for a developer and goes to
 * the logs; `publicMessage` is written for a client and goes over the wire.
 * They are separate fields so a stack trace, SQL fragment or upstream provider
 * error can never leak into an API response by accident.
 *
 * See docs/error-handling.md.
 */

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'EMPTY_INPUT'
  | 'INPUT_TOO_LARGE'
  | 'AI_UNAVAILABLE'
  | 'AI_TIMEOUT'
  | 'AI_INVALID_OUTPUT'
  | 'DATABASE_ERROR'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  EMPTY_INPUT: 400,
  INPUT_TOO_LARGE: 413,
  AI_UNAVAILABLE: 503,
  AI_TIMEOUT: 504,
  AI_INVALID_OUTPUT: 502,
  DATABASE_ERROR: 503,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

/** Client-safe wording. Never mentions Postgres, a provider or a stack frame. */
const PUBLIC_MESSAGE_BY_CODE: Record<ErrorCode, string> = {
  VALIDATION_ERROR: 'The request body was not valid.',
  EMPTY_INPUT: 'Please provide some text to analyze.',
  INPUT_TOO_LARGE: 'That message is too long to analyze in one request.',
  AI_UNAVAILABLE: 'Conversation analysis is temporarily unavailable. Please try again shortly.',
  AI_TIMEOUT: 'Analyzing that message took too long. Please try again.',
  AI_INVALID_OUTPUT: 'Analysis could not be completed for that message. Please try again.',
  DATABASE_ERROR: 'Lifelog could not save that right now. Please try again shortly.',
  NOT_FOUND: 'The requested resource does not exist.',
  RATE_LIMITED: 'Too many requests. Please slow down.',
  INTERNAL_ERROR: 'Something went wrong on our side.',
};

export interface ErrorDetail {
  path: string;
  message: string;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly publicMessage: string;
  readonly details: ErrorDetail[];
  /** True for errors the client can reasonably retry. */
  readonly retryable: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    options: {
      details?: ErrorDetail[];
      publicMessage?: string;
      cause?: unknown;
      retryable?: boolean;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.statusCode = STATUS_BY_CODE[code];
    this.publicMessage = options.publicMessage ?? PUBLIC_MESSAGE_BY_CODE[code];
    this.details = options.details ?? [];
    this.retryable = options.retryable ?? this.statusCode >= 500;
  }

  static validation(details: ErrorDetail[], message = 'request validation failed'): AppError {
    return new AppError('VALIDATION_ERROR', message, { details });
  }

  static internal(message: string, cause?: unknown): AppError {
    return new AppError('INTERNAL_ERROR', message, { cause });
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
