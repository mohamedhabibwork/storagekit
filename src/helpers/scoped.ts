import { normalizeKey, stripKey } from "../core/paths";
import type { ListOptions, ListResult, Storage, StorageFile } from "../core/types";

/**
 * Return a view of `storage` confined to `scope` (e.g. a tenant or user
 * id). Every path is resolved under the scope and listings / results are
 * reported relative to it, so code using the view cannot address files
 * outside its namespace (`..` is rejected by path normalization).
 * The underlying storage, hooks and native client are shared.
 */
export function scopedStorage<T extends string>(storage: Storage<T>, scope: string): Storage<T> {
  const root = normalizeKey(scope);
  const inScope = (path: string): string => `${root}/${normalizeKey(path)}`;
  const listPrefix = (prefix: string | undefined): string => {
    const trimmed = (prefix ?? "").replace(/^\/+/, "");
    if (trimmed === "") return `${root}/`;
    const trailing = trimmed.endsWith("/") ? "/" : "";
    return `${inScope(trimmed)}${trailing}`;
  };
  const out = (path: string): string => stripKey(root, path);
  const outFile = (file: StorageFile): StorageFile => ({ ...file, path: out(file.path) });

  const view: Storage<T> = {
    type: storage.type,
    hooks: storage.hooks,
    upload: async (path, body, options) => {
      const result = await storage.upload(inScope(path), body, options);
      return { ...result, path: out(result.path) };
    },
    download: async (path, options) => storage.download(inScope(path), options),
    delete: async (path, options) => storage.delete(inScope(path), options),
    deleteMany: async (paths, options) => {
      const result = await storage.deleteMany(paths.map(inScope), options);
      return {
        deleted: result.deleted.map(out),
        failed: result.failed.map((entry) => ({ ...entry, path: out(entry.path) })),
      };
    },
    exists: async (path, options) => storage.exists(inScope(path), options),
    stat: async (path, options) => {
      const result = await storage.stat(inScope(path), options);
      return { ...result, path: out(result.path) };
    },
    list: async (options: ListOptions<T> = {}): Promise<ListResult<T>> => {
      const result = await storage.list({ ...options, prefix: listPrefix(options.prefix) });
      return {
        ...result,
        files: result.files.map(outFile),
        directories: result.directories.map(out),
      };
    },
    iterate: (prefix, options) => {
      const source = storage.iterate(listPrefix(prefix), options);
      return (async function* () {
        for await (const file of source) yield outFile(file);
      })();
    },
    copy: async (source, destination, options) => {
      const result = await storage.copy(inScope(source), inScope(destination), options);
      return { ...result, source: out(result.source), destination: out(result.destination) };
    },
    move: async (source, destination, options) => {
      const result = await storage.move(inScope(source), inScope(destination), options);
      return { ...result, source: out(result.source), destination: out(result.destination) };
    },
    getUrl: async (path, options) => storage.getUrl(inScope(path), options),
    getSignedUrl: async (path, options) => storage.getSignedUrl(inScope(path), options),
    native: () => storage.native(),
    nativeRequest: (fn) => storage.nativeRequest(fn),
    capabilities: () => storage.capabilities(),
    on: (event, listener) => storage.on(event, listener),
  };
  return view;
}
