#!/usr/bin/env node
// Render assets/logo.svg to PNG icons at the four sizes Chrome needs.
// Run via: npm run icons
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SOURCE = join(ROOT, 'assets', 'logo.svg');
const OUT_DIR = join(ROOT, 'extension', 'icons');
const SIZES = [16, 32, 48, 128];

const svg = await readFile(SOURCE);
await mkdir(OUT_DIR, { recursive: true });

for (const size of SIZES) {
  const out = join(OUT_DIR, `icon-${size}.png`);
  await sharp(svg).resize(size, size, { fit: 'contain' }).png().toFile(out);
  console.log(`wrote ${size}x${size} -> ${out}`);
}
