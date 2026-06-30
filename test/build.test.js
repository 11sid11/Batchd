import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBanner } from '../scripts/build.js';

const MOCK_PKG = {
  name: 'batchd',
  version: '9.9.9-test',
  description: 'Test description',
  homepage: 'https://github.com/11sid11/Batchd',
  repository: { url: 'git+https://github.com/11sid11/Batchd.git' },
  bugs: { url: 'https://github.com/11sid11/Batchd/issues' },
  license: 'MIT',
};

test('renderBanner wraps the metadata in ==UserScript== markers', () => {
  const banner = renderBanner(MOCK_PKG);
  assert.ok(banner.startsWith('// ==UserScript==\n'), 'should start with the opening marker');
  assert.ok(banner.includes('\n// ==/UserScript==\n'), 'should include the closing marker');
});

test('renderBanner includes the canonical @name and @version from package.json', () => {
  const banner = renderBanner(MOCK_PKG);
  assert.match(banner, /\/\/ @name\s+Batchd\b/);
  assert.match(banner, /\/\/ @version\s+9\.9\.9-test\b/);
});

test('renderBanner keeps the original @match, @grant, and @run-at fields', () => {
  const banner = renderBanner(MOCK_PKG);
  assert.match(banner, /\/\/ @match\s+https:\/\/x\.com\/\*/);
  assert.match(banner, /\/\/ @match\s+https:\/\/twitter\.com\/\*/);
  assert.match(banner, /\/\/ @grant\s+GM_getValue\b/);
  assert.match(banner, /\/\/ @grant\s+GM_setValue\b/);
  assert.match(banner, /\/\/ @run-at\s+document-end\b/);
});

test('renderBanner points @updateURL and @downloadURL at the GitHub release "latest" download', () => {
  // Strategy B: Tampermonkey fetches the most recent release asset. This URL
  // works for both first install and auto-update, and follows the existing
  // release flow (which already uploads dist/batchd.user.js as an asset).
  const banner = renderBanner(MOCK_PKG);
  const releaseUrl = 'https://github.com/11sid11/Batchd/releases/latest/download/batchd.user.js';
  assert.match(banner, new RegExp(`// @updateURL\\s+${escapeRegExp(releaseUrl)}`));
  assert.match(banner, new RegExp(`// @downloadURL\\s+${escapeRegExp(releaseUrl)}`));
});

test('renderBanner includes the polish fields (@author, @license, @homepage, @supportURL)', () => {
  const banner = renderBanner(MOCK_PKG);
  assert.match(banner, /\/\/ @author\s+\S+/);
  assert.match(banner, /\/\/ @license\s+MIT\b/);
  assert.match(banner, /\/\/ @homepage\s+https:\/\/github\.com\/11sid11\/Batchd\b/);
  assert.match(banner, /\/\/ @supportURL\s+https:\/\/github\.com\/11sid11\/Batchd\/issues\b/);
});

test('renderBanner points @icon at the logo in the repo (raw.githubusercontent.com, master branch)', () => {
  // The logo lives in assets/logo.svg on the master branch — referencing it
  // here (vs strategy A) is fine because the logo is in the source tree, not
  // a build artifact that needs to be in a release asset.
  const banner = renderBanner(MOCK_PKG);
  const iconUrl = 'https://raw.githubusercontent.com/11sid11/Batchd/master/assets/logo.svg';
  assert.match(banner, new RegExp(`// @icon\\s+${escapeRegExp(iconUrl)}`));
});

test('renderBanner does not regress on a missing/empty optional pkg field', () => {
  // Defensive: if anyone hand-edits package.json and removes license/homepage
  // (they shouldn't, but…), the banner should still be well-formed.
  const minimal = { name: 'batchd', version: '0.0.1' };
  const banner = renderBanner(minimal);
  assert.ok(banner.startsWith('// ==UserScript==\n'));
  assert.ok(banner.includes('// ==/UserScript==\n'));
  assert.match(banner, /\/\/ @version\s+0\.0\.1\b/);
});

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
