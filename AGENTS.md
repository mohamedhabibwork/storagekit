# AGENTS.md

Guidance for AI coding agents (and humans) working in this repository.

## What this is

**StorageKit** (`@mohamedhabibwork/storagekit`) — unified file management across Local, S3,
MinIO, Azure Blob, Oracle OCI, RustFS, R2, and Google Cloud Storage with provider-native
options preserved under `native`. Zero runtime dependencies; provider SDKs are optional peers
loaded only when a storage is created. Node >= 20, Bun, Deno; dual ESM/CJS.

## Layout

- `src/core/` — primitives, errors, paths, mime, streams, types (leaf layer; type-only
  references to driver `*.types` allowed for the native-options map in `core/maps.ts`).
- `src/drivers/<name>/` — one folder per provider: `<name>.driver.ts`, `<name>.types.ts`,
  and an `index.ts` facade that re-exports `createStorage`. S3-protocol reuses (r2, rustfs)
  import the s3 driver; no other sibling imports.
- `src/uploads/` — upload intake (`saveUpload`, `saveWebFile`, `sanitizeFilename`, `randomKey`).
- `src/adapters/` — framework glue: express (multer engine), fastify, formidable. Adapters
  import nothing from the frameworks (structural types only).
- `src/testing/` — fake driver + shared driver-contract suite.
- Root `src/*.ts` — composition: index, factory, storage, manager, copy-between.
- `tests/` — unit + `tests/architecture.test.ts` (boundary guard) + peer-dependency tests;
  `tests/integrations/` needs cloud credentials (skipped locally); `types/` holds
  `expectTypeOf` type tests.
- `docs/` — MkDocs source (rendered to the GitHub Pages site), shipped in the npm tarball.

## Commands

```sh
npm ci             # install exactly the lockfile (dev deps only)
npm run check      # format:check -> lint -> typecheck -> test -> build  (the gate)
npm run lint:fix   # oxlint --fix
npm run format     # oxfmt (also formats docs/*.md)
npm test           # vitest run
npm run test:types # type-level tests only
npm run build      # tsup + tsc d.ts build + scripts/fix-dts.mjs
```

CI fails on any lint warning (`--deny-warnings`), any formatting diff, or any architecture
violation. Run `npm run check` before declaring anything done.

## Conventions

- **Formatting is oxfmt, not opinion**: never hand-format; run `npm run format`.
- **Lint**: `.oxlintrc.json` enables correctness/suspicious/perf across typescript, unicorn,
  import, promise plugins; tests relax `no-console`/`no-underscore-dangle`/function-scoping.
  For intentional code, use an inline `// oxlint-disable-next-line <rule>` with a reason.
- **Architecture**: `tests/architecture.test.ts` enforces layering. New edges require
  updating the test AND `docs/architecture.md` together. Driver implementations never import
  sibling drivers (r2/rustfs → s3 is the only sanctioned reuse).
- **Dependencies**: no runtime dependencies. Provider SDKs are optional peers loaded via
  dynamic `import()` and must throw `StorageInvalidConfigError` with the exact
  `npm install` command when missing (covered by `tests/peer-dependencies.test.ts`).
- **Errors**: typed `Storage*Error` subclasses; provider errors preserved on `cause`;
  credentials never appear in messages.
- **Docs**: README, `llms.txt`, `docs/*.md`, and the mkdocs nav (`mkdocs.yml`) are part of
  the deliverable; API changes update all of them.

## Gotchas

- `Storage` methods: `upload`, `download`, `exists`, `stat`, `list`, `copy`, `move`,
  `delete`, `deleteMany`, `getUrl`, `getSignedUrl` — there is no `put`/`get`.
- Delete operations are idempotent; `download`/`stat` throw `StorageNotFoundError`.
- `keys` are `/`-normalized; `..` traversal throws `StorageInvalidPathError`.
- The multer engine's `_handleFile`/`_removeFile` names are multer's contract — exempt from
  `no-underscore-dangle` via the tests override and in `src/adapters/express.ts`.
- Build runs `scripts/fix-dts.mjs` after tsc; declaration specifiers are rewritten — do not
  hand-edit `dist/`.
