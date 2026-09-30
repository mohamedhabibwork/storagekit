import { existsSync, readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Architecture guard: which src layers may import which.
 *
 * Layers (bottom-up):
 *   core       — provider-agnostic primitives, errors, paths, mime, streams, types.
 *                Depends on nothing internal, except type-only references to a
 *                driver's public option types (core/maps.ts native-options map).
 *   drivers/X  — one folder per provider. Implementation files may use core, the
 *                StorageDriver contract (drivers/driver.ts), their own folder, and
 *                the s3 driver for S3-protocol reuses (r2, rustfs). Never a sibling
 *                driver otherwise. drivers/X/index.ts is the per-driver public
 *                facade and may compose anything.
 *   uploads    — multipart upload machinery. Core only.
 *   adapters   — framework glue (express, fastify, formidable). Core + uploads.
 *   testing    — fakes and driver contract tests. Core, driver contract, storage.
 *   root       — composition layer (index, factory, storage, manager, copy-between).
 *                Unrestricted.
 *
 * A violation means a layer reached across its boundary; fix the dependency
 * direction instead of widening the allow-list unless ARCHITECTURE.md agrees.
 */

const SRC = resolve(import.meta.dirname, "../src");

type ImportKind = "type" | "value";

interface Rule {
  applies: (file: string) => boolean;
  allows: (file: string, target: string, kind: ImportKind) => boolean;
}

const sameDriver = (file: string, target: string): boolean =>
  file.startsWith("drivers/") && target.startsWith(`drivers/${file.split("/")[1]}/`);

const s3Compatible = (file: string, target: string): boolean =>
  /^drivers\/(r2|rustfs)\//.test(file) && target.startsWith("drivers/s3/");

const rules: Rule[] = [
  {
    applies: (f) => f.startsWith("core/"),
    allows: (_f, t, kind) =>
      t.startsWith("core/") ||
      (kind === "type" && /^drivers\/[a-z0-9-]+\/[a-z0-9-]+\.types\.ts$/.test(t)),
  },
  {
    applies: (f) => f.startsWith("drivers/") && !f.endsWith("/index.ts"),
    allows: (f, t) =>
      t.startsWith("core/") || t === "drivers/driver.ts" || sameDriver(f, t) || s3Compatible(f, t),
  },
  { applies: (f) => f.startsWith("drivers/") && f.endsWith("/index.ts"), allows: () => true },
  { applies: (f) => f.startsWith("uploads/"), allows: (_f, t) => t.startsWith("core/") },
  {
    applies: (f) => f.startsWith("adapters/"),
    allows: (_f, t) => t.startsWith("core/") || t.startsWith("uploads/"),
  },
  {
    applies: (f) => f.startsWith("testing/"),
    allows: (_f, t) =>
      t.startsWith("core/") ||
      t === "drivers/driver.ts" ||
      t === "storage.ts" ||
      t.startsWith("testing/"),
  },
];

function* tsFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) yield* tsFiles(path);
    else if (entry.name.endsWith(".ts")) yield path;
  }
}

function resolveTarget(file: string, spec: string): string {
  const base = resolve(file, "..", spec.replace(/\.js$/, ""));
  const candidates = [`${base}.ts`, resolve(base, "index.ts"), base];
  const absolute = candidates.find((candidate) => existsSync(candidate)) ?? base;
  return relative(SRC, absolute).split("\\").join("/");
}

function relativeImports(file: string): { target: string; kind: ImportKind }[] {
  const text = readFileSync(file, "utf8");
  const statement =
    /(?:^|\n)\s*(?:import|export)\b([^;\n]*?)from\s*['"](\.[^'"]*)['"]|\bimport\(\s*['"](\.[^'"]*)['"]\s*\)/g;
  const imports: { target: string; kind: ImportKind }[] = [];
  for (const match of text.matchAll(statement)) {
    const spec = match[2] ?? match[3]!;
    const typeOnly =
      match[1] !== undefined
        ? match[1].trimStart().startsWith("type")
        : /(?:^|\W)typeof\s*$/.test(text.slice(Math.max(0, match.index! - 16), match.index!));
    imports.push({ target: resolveTarget(file, spec), kind: typeOnly ? "type" : "value" });
  }
  return imports;
}

describe("architecture", () => {
  it("keeps every import inside its layer boundary", () => {
    const violations: string[] = [];
    for (const file of tsFiles(SRC)) {
      const fileRel = relative(SRC, file).split("\\").join("/");
      if (!fileRel.includes("/")) continue; // root files are the composition layer
      for (const { target, kind } of relativeImports(file)) {
        for (const rule of rules) {
          if (rule.applies(fileRel) && !rule.allows(fileRel, target, kind)) {
            violations.push(`${fileRel} -> ${target} [${kind}]`);
          }
        }
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });
});
