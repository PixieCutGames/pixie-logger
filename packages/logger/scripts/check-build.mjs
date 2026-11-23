import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { transform } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

const ENTRIES = ['index', 'web', 'capacitor', 'react-native'];
const EXTENSIONS = ['.js', '.cjs', '.d.ts', '.d.cts'];
const STUBS = ['web', 'capacitor', 'react-native'];
const STUB_FIELDS = ['main', 'module', 'types'];
const PLATFORM_IMPORTS = ['@capacitor/', "react-native'", 'react-native"', '@react-native-async-storage'];
const MAX_CORE_BYTES = 12288;

function fail(message) {
  console.error(`check-build failed: ${message}`);
  process.exit(1);
}

if (!existsSync(dist)) fail('dist/ does not exist. Run the build first.');

// 1. Every expected file exists.
const missing = ENTRIES.flatMap((entry) => EXTENSIONS.map((ext) => `${entry}${ext}`)).filter(
  (file) => !existsSync(join(dist, file)),
);
if (missing.length > 0) fail(`missing from dist/: ${missing.join(', ')}`);

const files = readdirSync(dist).filter((file) => !file.endsWith('.map'));

// 2. No zod.
for (const file of files) {
  if (readFileSync(join(dist, file), 'utf8').includes('zod')) fail(`dist/${file} contains "zod"`);
}

// 3. No platform imports.
for (const file of files.filter((name) => name.endsWith('.js') || name.endsWith('.cjs'))) {
  const code = readFileSync(join(dist, file), 'utf8');
  const found = PLATFORM_IMPORTS.find((needle) => code.includes(needle));
  if (found) fail(`dist/${file} contains platform import ${found}`);
}

// 3b. Declarations are self-contained.
const RELATIVE_IMPORT = /(?:from\s+|import\s+|import\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g;
const declarationCandidates = (specifier) => {
  const base = specifier.replace(/\.(?:js|cjs|mjs)$/, '');
  return [specifier, `${specifier}.d.ts`, `${specifier}.d.cts`, `${base}.d.ts`, `${base}.d.cts`];
};
for (const file of files.filter((name) => name.endsWith('.d.ts') || name.endsWith('.d.cts'))) {
  const lines = readFileSync(join(dist, file), 'utf8').split('\n');
  lines.forEach((line, index) => {
    const where = `dist/${file}:${index + 1}`;
    if (line.includes('@pixie-logger/shared')) fail(`${where} references @pixie-logger/shared: ${line.trim()}`);
    if (line.includes("from 'zod'") || line.includes('from "zod"')) fail(`${where} imports zod: ${line.trim()}`);
    for (const [, specifier] of line.matchAll(RELATIVE_IMPORT)) {
      if (!declarationCandidates(specifier).some((candidate) => existsSync(join(dist, candidate)))) {
        fail(`${where} has an unresolved import: ${line.trim()}`);
      }
    }
  });
}

// 4. Size budget.
const rows = [];
for (const entry of ENTRIES) {
  const source = readFileSync(join(dist, `${entry}.js`), 'utf8');
  const { code } = await transform(source, { minify: true });
  rows.push({
    entry,
    minified: Buffer.byteLength(code),
    gzip: gzipSync(code).length,
  });
}
const core = rows.find((row) => row.entry === 'index');
if (core.minified > MAX_CORE_BYTES) {
  fail(`dist/index.js is ${core.minified} bytes minified, over the ${MAX_CORE_BYTES} byte budget`);
}

// 5. Stubs point at files that exist.
for (const stub of STUBS) {
  const stubDir = join(root, stub);
  const stubFile = join(stubDir, 'package.json');
  if (!existsSync(stubFile)) fail(`missing stub ${stub}/package.json`);
  const manifest = JSON.parse(readFileSync(stubFile, 'utf8'));
  for (const field of STUB_FIELDS) {
    if (typeof manifest[field] !== 'string') fail(`${stub}/package.json has no "${field}"`);
    if (!existsSync(resolve(stubDir, manifest[field]))) {
      fail(`${stub}/package.json "${field}" points at missing file ${manifest[field]}`);
    }
  }
}

console.log('check-build passed');
console.table(Object.fromEntries(rows.map(({ entry, minified, gzip }) => [entry, { 'minified (bytes)': minified, 'gzip (bytes)': gzip }])));
console.log(`core budget: ${core.minified} / ${MAX_CORE_BYTES} bytes`);
