import type { Storage, StorageFile } from "../core/types";

export interface ListAllOptions {
  /** Stop after this many files (guards against unbounded memory use). */
  max?: number;
  /** Keep only files matching this predicate. */
  filter?: (file: StorageFile) => boolean;
  signal?: AbortSignal;
}

/**
 * Collect every file under `prefix` into an array, following pagination.
 * Prefer `storage.iterate()` for very large prefixes.
 */
export async function listAll<T extends string>(
  storage: Storage<T>,
  prefix?: string,
  options: ListAllOptions = {},
): Promise<StorageFile[]> {
  const max = options.max ?? Number.POSITIVE_INFINITY;
  if (!(max > 0)) throw new TypeError("listAll max must be a positive number");
  const files: StorageFile[] = [];
  for await (const file of storage.iterate(prefix, { signal: options.signal })) {
    if (options.filter && !options.filter(file)) continue;
    files.push(file);
    if (files.length >= max) break;
  }
  return files;
}
