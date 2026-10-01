import { createHash } from "node:crypto";

import type { Storage } from "../core/types";

export type ChecksumAlgorithm = "md5" | "sha1" | "sha256" | "sha512";
export type ChecksumEncoding = "hex" | "base64";

export interface ChecksumOptions {
  /** Defaults to "sha256". */
  algorithm?: ChecksumAlgorithm;
  /** Defaults to "hex". */
  encoding?: ChecksumEncoding;
  signal?: AbortSignal;
}

/**
 * Stream a stored file through a hash without buffering it. Useful to
 * verify integrity after transfers or to deduplicate content; ETags are
 * not reliable checksums (multipart uploads, encryption, providers).
 */
export async function checksum<T extends string>(
  storage: Storage<T>,
  path: string,
  options: ChecksumOptions = {},
): Promise<string> {
  const hash = createHash(options.algorithm ?? "sha256");
  const download = await storage.download(path, { signal: options.signal });
  for await (const chunk of download.stream) {
    hash.update(chunk as Buffer);
  }
  return hash.digest(options.encoding ?? "hex");
}
