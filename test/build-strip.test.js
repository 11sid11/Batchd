import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { renderBanner, TM_ENTRY } from "../scripts/build.js";

test("the build strips the ==UserScript== block from the Tampermonkey entry source so it is not duplicated in the bundle", () => {
  // The src/batchd.user.js file contains a ==UserScript== metadata block
  // at the top of the file (after some leading comments). The build's
  // strip regex must match across newlines (m flag) so the block is
  // removed and the bundle has only the rendered banner at the top.
  // Regression guard: a previous version of build.js was missing the m
  // flag, which caused the ==UserScript== block to leak into the bundle
  // ~3KB deep, with a hardcoded @version 0.2.0 that was stale.
  const src = fs.readFileSync(path.join("src", TM_ENTRY), "utf8");
  const stripped = src.replace(
    /^\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==\s*/m,
    "",
  );
  assert.equal(
    stripped.includes("==UserScript=="),
    false,
    "==UserScript== block should be stripped from the entry source",
  );
});

test("renderBanner does not depend on the strip; the bundle has the rendered banner at the top", () => {
  const pkg = { name: "batchd", version: "0.3.0" };
  const banner = renderBanner(pkg);
  assert.ok(banner.startsWith("// ==UserScript==\n"));
  const opens = (banner.match(/==UserScript==/g) || []).length;
  const closes = (banner.match(/==\/UserScript==/g) || []).length;
  assert.equal(opens, 1);
  assert.equal(closes, 1);
});
