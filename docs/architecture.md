# Architecture

Unified file management across Local, S3, Cloudflare R2, MinIO, Azure Blob, Oracle OCI, Google
Cloud Storage, and RustFS. Provider SDKs are optional peer dependencies loaded dynamically at
creation time, so consumers install only what they use.

## Layers

Dependencies point one way, bottom-up:

| Layer                 | Contents                                                                                       | May depend on                                                                                                                           |
| --------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core/`           | Primitives, errors, paths, mime, streams, types                                                | itself, plus type-only imports of a driver's public `*.types` (the native-options map in `core/maps.ts`)                                |
| `src/drivers/<name>/` | One folder per provider: `<name>.driver.ts`, `<name>.types.ts`, and a public `index.ts` facade | core, the `StorageDriver` contract (`drivers/driver.ts`), its own folder; S3-protocol reuses (r2, rustfs) may also import the s3 driver |
| `src/uploads/`        | Multipart upload machinery                                                                     | core                                                                                                                                    |
| `src/adapters/`       | Framework glue (express, fastify, formidable)                                                  | core + uploads                                                                                                                          |
| `src/testing/`        | Fake driver and shared driver-contract suite                                                   | core, driver contract, storage                                                                                                          |
| `src/*.ts` (root)     | Composition: index, factory, storage, manager, copy-between                                    | anything                                                                                                                                |

These rules are enforced by `tests/architecture.test.ts`: it walks every file under `src/`,
resolves each relative import, and fails when a layer reaches outside its boundary. If a
legitimate new edge is needed, widen the allow-list in the test and this document together.

### Adding a driver

1. Create `src/drivers/<name>/` with `<name>.driver.ts` implementing `StorageDriver` from
   `drivers/driver.ts`, a `<name>.types.ts` for config and native options, and an `index.ts`
   facade that composes `createStorage`.
2. Load the SDK dynamically so the package stays an optional peer dependency; register the
   native options in `core/maps.ts` (type-only) and the driver in `src/factory.ts`.
3. Add the entry to `package.json` exports and wire the shared contract in
   `src/testing/driver-contract.ts`.
4. `npm run check` — the architecture test proves the driver stayed self-contained.

## Clean-code toolchain

Linting and formatting are enforced by oxlint and oxfmt:

| Command                | What it does                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------- |
| `npm run lint`         | `oxlint --deny-warnings --report-unused-disable-directives` — fails on any warning |
| `npm run lint:fix`     | Auto-fix what oxlint can                                                           |
| `npm run format`       | `oxfmt` — canonical formatting for every source file                               |
| `npm run format:check` | CI gate for formatting                                                             |
| `npm run check`        | format:check → lint → typecheck → test → build                                     |

The lint config (`.oxlintrc.json`) enables the `correctness`, `suspicious`, and `perf` categories
across the `typescript`, `unicorn`, `import`, and `promise` plugins, plus targeted rules:
`no-unused-vars` (with `_`-prefix opt-out), `no-console` (allowing `warn`/`error` only),
`prefer-node-protocol`, `no-array-reduce`, `no-require-imports`, `import/no-duplicates`,
`promise/no-nesting`, and `promise/always-return`. Tests and scripts get a narrower rule set via
`overrides` (for example, multer's `StorageEngine` contract requires `_`-prefixed methods).
Anything intentionally outside the rules is marked inline with a reason
(`// oxlint-disable-next-line <rule> -- why`) rather than a blanket exclusion.
