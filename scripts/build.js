// Build script - concatenates src/*.js into a single distributable
// userscript file at dist/batchd.user.js.
//
// ESM `export` syntax is rewritten to global namespace assignments so the
// concatenated file runs as a classic Tampermonkey script (no module loader).
//
// Order matters: modules are concatenated in dependency order, with the
// entry point (batchd.user.js) last. Each module exposes its public
// surface via globalThis.Batchd.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ORDER = [
  'pacing.js',
  'persist.js',
  'failures.js',
  'selectors.js',
  'run.js',
  'panel.js',
  'batchd.user.js',     // entry point - last
];

const OUT_DIR = 'dist';
const OUT_FILE = `${OUT_DIR}/batchd.user.js`;

// Repo identity - hardcoded so forking the project is a deliberate edit
// here, not a hunt through package.json. If Batchd ever moves, change
// this block once and the banner follows.
const HOMEPAGE       = 'https://github.com/11sid11/Batchd';
const SUPPORT_URL    = `${HOMEPAGE}/issues`;
const RELEASE_URL    = `${HOMEPAGE}/releases/latest/download/batchd.user.js`;
const ICON_URL       = 'https://raw.githubusercontent.com/11sid11/Batchd/master/assets/logo.svg';
const AUTHOR         = '11sid11';
const LICENSE        = 'MIT';
const DEFAULT_DESC   = 'Bulk-delete your X.com likes and replies.';

// Renders the Tampermonkey ==UserScript== metadata block that sits at the top
// of the built userscript. Exported so tests can assert on the exact fields
// without running a build.
//
// Strategy B for auto-update: @updateURL and @downloadURL both point at the
// GitHub release "latest" download. The release process already uploads
// dist/batchd.user.js as a release asset, so the always-current asset lives
// at that URL. Tampermonkey follows the 302 -> S3 redirect transparently.
// No need to commit dist/ to the repo.
export function renderBanner(pkg) {
  const version     = pkg.version;
  const description = pkg.description || DEFAULT_DESC;

  return `// ==UserScript==
// @name         Batchd
// @namespace    batchd
// @version      ${version}
// @description  ${description}
// @author       ${AUTHOR}
// @license      ${LICENSE}
// @homepage     ${HOMEPAGE}
// @supportURL   ${SUPPORT_URL}
// @icon         ${ICON_URL}
// @updateURL    ${RELEASE_URL}
// @downloadURL  ${RELEASE_URL}
// @match        https://x.com/*
// @match        https://twitter.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-end
// ==/UserScript==

`;
}

function rewriteEsm(src, filename) {
  // 1. `export function NAME(...)` -> `function NAME(...)` plus `Batchd.NAME = NAME`
  // 2. `export const NAME = ...`  -> `const NAME = ...`
  // 3. `import { X, Y } from './foo.js'` -> `const { X, Y } = Batchd;`
  // 4. `export { X, Y };` -> `Batchd.X = X; Batchd.Y = Y;`
  // 5. `export default X;` -> `Batchd.default = X;`

  let out = src;

  // Hoist imports to a single Batchd-destructure
  out = out.replace(
    /^import\s*\{\s*([^}]+)\s*\}\s*from\s*['"][^'"]+['"];?\s*$/gm,
    (_, names) => `const { ${names.trim()} } = Batchd;`
  );

  // export function NAME  /  export async function NAME
  // Keep the function as a *local* declaration so that bare references inside
  // the same file (e.g. `defaultState()` called from `readFromStorage`) keep
  // resolving. Function declarations are hoisted, so they remain in scope
  // regardless of source order. We then alias each exported function onto
  // `Batchd` at the end of the chunk so external files can still reach it
  // via the destructure pattern (`const { foo } = Batchd;`).
  const exportedFns = [];
  out = out.replace(/^export\s+(async\s+)?function\s+(\w+)/gm, (_, asyncKw, name) => {
    exportedFns.push(name);
    return `${asyncKw || ''}function ${name}`;
  });

  if (exportedFns.length > 0) {
    out += '\n' + exportedFns.map((n) => `Batchd.${n} = ${n};`).join('\n') + '\n';
  }

  // Strip `export ` from `export const` lines so they stay as plain local
  // `const` declarations in the bundle. Two reasons:
  //   1. Classic-script context forbids the `export` keyword - Tampermonkey
  //      loads the bundle as a classic script and would throw
  //      "Unexpected token 'export'" on the literal token.
  //   2. We want the constant to remain a local binding so the same file's
  //      other functions can reference it bare (e.g. `STATE_KEY` inside
  //      `createStore`). Rewriting to `Batchd.X = ...` would orphan those
  //      references since the file has no `import` statement to inject a
  //      destructure from Batchd.
  // Node tests still import these via ESM (`import { X } from './foo.js'`)
  // because the source files remain real ESM; only the bundled artifact
  // treats them as locals.
  out = out.replace(/^export\s+const\s+/gm, 'const ');

  // export { a, b, c };
  out = out.replace(/^export\s*\{\s*([^}]+)\s*\};?\s*$/gm, (_, list) =>
    list.split(',').map((s) => {
      const name = s.trim().split(/\s+as\s+/)[0];
      return `Batchd.${name} = ${name};`;
    }).join('\n')
  );

  // export default X
  out = out.replace(/^export\s+default\s+/gm, 'Batchd.default = ');

  return out;
}

async function build() {
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  const banner = renderBanner(pkg);

  const parts = [];

  // Outer IIFE - declares the shared `Batchd` namespace once. Each module is
  // then wrapped in its OWN inner IIFE so local bindings (function
  // declarations, `const` aliases) don't leak into other modules' scopes.
  // Without the per-file IIFE, a `function findEngagedPosts()` declared in
  // selectors.js would collide with `const { findEngagedPosts } = Batchd`
  // declared in run.js - both would bind the same name at the outer scope.
  parts.push('// <auto-generated by scripts/build.js - do not edit>\n');
  parts.push('(function () {\n');
  parts.push('  "use strict";\n');
  parts.push('  const Batchd = {};\n');
  parts.push('  const globalThis = window;\n');
  parts.push('  globalThis.Batchd = Batchd;\n\n');

  for (const filename of ORDER) {
    const src = await readFile(`src/${filename}`, 'utf8');
    const rewritten = rewriteEsm(src, filename);

    // For the entry point: strip the @grant/@match header block - the build
    // script writes its own header at the top of the bundle.
    const cleaned = filename === 'batchd.user.js'
      ? rewritten.replace(/^\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==\s*/, '')
      : rewritten;

    parts.push(`  // ---- src/${filename} ----\n`);
    parts.push('  (function () {\n');
    parts.push(cleaned.replace(/^/gm, '    '));   // indent one level deeper
    parts.push('\n  })();\n\n');
  }

  parts.push('})();\n');

  if (!existsSync(OUT_DIR)) await mkdir(OUT_DIR, { recursive: true });
  const out = banner + parts.join('');
  await writeFile(OUT_FILE, out);
  console.log(`built ${OUT_FILE} (${out.length} bytes)`);
}

// Only run the build when this file is the entry point (e.g.
// `node scripts/build.js` or `npm run build`). Imports from tests must
// NOT trigger a build - tests want to call renderBanner() in isolation
// without side effects.
const isMain = process.argv[1] && (
  fileURLToPath(import.meta.url) === process.argv[1] ||
  // Windows: the shell may canonicalize argv[1] differently (8.3 short
  // paths, forward vs back slashes). Fall back to a suffix match.
  process.argv[1].endsWith('scripts/build.js') ||
  process.argv[1].endsWith('scripts\\build.js')
);

if (isMain) {
  build().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
