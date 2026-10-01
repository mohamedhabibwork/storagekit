import type { DeleteManyResult, Storage } from "../core/types";

export interface DeletePrefixOptions {
  /** Paths sent per `deleteMany()` call. Defaults to 1000. */
  batchSize?: number;
  signal?: AbortSignal;
}

const DEFAULT_BATCH_SIZE = 1000;

/**
 * Recursively delete every file under `prefix` ("delete a directory"),
 * following pagination and batching through `deleteMany()`.
 * An empty prefix is rejected so a bucket can never be wiped by accident.
 */
export async function deletePrefix<T extends string>(
  storage: Storage<T>,
  prefix: string,
  options: DeletePrefixOptions = {},
): Promise<DeleteManyResult> {
  if (typeof prefix !== "string" || prefix.replace(/^\/+/, "").length === 0) {
    throw new TypeError("deletePrefix requires a non-empty prefix");
  }
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new TypeError("deletePrefix batchSize must be a positive integer");
  }

  // Collect first: deleting while paginating can invalidate cursors.
  const paths: string[] = [];
  for await (const file of storage.iterate(prefix, { signal: options.signal })) {
    paths.push(file.path);
  }

  let deleted: string[] = [];
  let failed: DeleteManyResult["failed"] = [];
  for (let index = 0; index < paths.length; index += batchSize) {
    const result = await storage.deleteMany(paths.slice(index, index + batchSize), {
      signal: options.signal,
    });
    deleted = [...deleted, ...result.deleted];
    failed = [...failed, ...result.failed];
  }
  return { deleted, failed };
}
