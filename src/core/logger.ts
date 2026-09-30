/**
 * Minimal structural logger contract shared by the @mohamedhabibwork kits.
 *
 * Any object with these four methods works — a `@mohamedhabibwork/loggerkit`
 * `Logger` satisfies it directly, as do pino, winston and `console`-shaped
 * adapters. No runtime dependency on loggerkit is required.
 */
export interface KitLogger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, errorOrFields?: Error | Record<string, unknown>): void;
}

const noop = (): void => {};

/** Logger that discards everything; the default when none is supplied. */
export const noopLogger: KitLogger = Object.freeze({
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
});

export function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}
