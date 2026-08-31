#!/usr/bin/env node
/**
 * Post-process emitted .d.ts files: append `.js` to extensionless relative
 * import/export specifiers so the declarations resolve under every TS
 * moduleResolution mode (node16/nodenext require explicit extensions).
 *
 * Source imports are extensionless (formatter convention); the declaration
 * emitter preserves them verbatim, so we normalize the output here.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../dist', import.meta.url).pathname;

let files = 0;
let rewritten = 0;

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) walk(full);
    else if (/\.d\.[cm]?ts$/.test(entry)) process(full);
  }
}

function process(file) {
  files += 1;
  const source = readFileSync(file, 'utf8');
  const rewriteFrom = (match, prefix, quote, specifier) => {
    if (/\.(js|cjs|mjs|json|d\.ts|ts)$/.test(specifier)) return match;
    rewritten += 1;
    return `${prefix}${quote}${specifier}.js${quote}`;
  };
  const rewriteImport = (match, prefix, quote, specifier, suffix) => {
    if (/\.(js|cjs|mjs|json|d\.ts|ts)$/.test(specifier)) return match;
    rewritten += 1;
    return `${prefix}${quote}${specifier}.js${suffix}`;
  };
  // `from './x'` statements and inline `import('./x')` type references
  const updated = source
    .replace(/(from\s+)(['"])(\.\.?\/[^'"]+?)(\2)/g, rewriteFrom)
    .replace(/(import\()(['"])(\.\.?\/[^'"]+?)(\2\))/g, rewriteImport);
  if (updated !== source) writeFileSync(file, updated);
}

walk(root);
console.log(`fix-dts: checked ${files} declaration files, rewrote ${rewritten} specifiers`);
