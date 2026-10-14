import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(resolve(root, "theme.json"), "utf8"));
const doc = readFileSync(resolve(root, "dist/index.html"), "utf8");
const findAsset = (kind, ext) => {
  const match = doc.match(
    new RegExp(`/assets/(${kind}\\.[0-9a-f]{16}\\.${ext})`),
  );
  assert.ok(match, `Missing hashed ${kind} asset in HTML`);
  return `dist/assets/${match[1]}`;
};
const jsFile = findAsset("main", "js");
const cssFile = findAsset("styles", "css");
const flagCodes = JSON.parse(
  readFileSync(resolve(root, "src/flag-codes.json"), "utf8"),
);

test("All 249 ISO flags and additional codes ship locally with their license", () => {
  assert.equal(flagCodes.iso.length, 249);
  const codes = [...flagCodes.iso, ...flagCodes.extra].sort();
  assert.equal(new Set(codes).size, codes.length);
  for (const directory of ["public/flags", "dist/flags"]) {
    assert.deepEqual(
      readdirSync(resolve(root, directory)).sort(),
      codes.map((code) => `${code}.svg`),
    );
  }
  for (const code of codes) {
    assert.match(code, /^[a-z]{2}$/);
    const source = readFileSync(resolve(root, `public/flags/${code}.svg`));
    assert.deepEqual(
      readFileSync(resolve(root, `dist/flags/${code}.svg`)),
      source,
    );
    assert.ok(source.length < 8 * 1024 ** 2);
    assert.doesNotMatch(
      source.toString(),
      /<script\b|\bon\w+\s*=|(?:href|src)\s*=\s*["'](?:https?:|\/\/|data:|javascript:)/i,
    );
  }
  const notices = readFileSync(
    resolve(root, "THIRD_PARTY_NOTICES.txt"),
    "utf8",
  );
  assert.match(notices, /flag-icons 7\.5\.0/);
  assert.match(notices, /Copyright \(c\) 2013 Panayiotis Lipiridis/);
  assert.match(notices, /Permission is hereby granted/);
});

test("Theme manifest meets required Hub fields", () => {
  for (const key of [
    "name",
    "short",
    "description",
    "version",
    "author",
    "url",
  ])
    assert.equal(typeof manifest[key], "string");
  assert.match(manifest.short, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(manifest.name, "");
  assert.equal(
    new Set(manifest.config.filter((f) => f.key).map((f) => f.key)).size,
    manifest.config.filter((f) => f.key).length,
  );
});
test("Standalone static application exists and is within size budget", () => {
  for (const f of [
    "dist/index.html",
    jsFile,
    cssFile,
    "dist/apple-touch-icon.png",
    "dist/favicon.svg",
  ]) {
    const p = resolve(root, f);
    assert.ok(existsSync(p), `${f} is missing`);
    assert.ok(statSync(p).size < 8 * 1024 ** 2, `${f} exceeds 8 MiB`);
  }
  assert.ok(
    readFileSync(resolve(root, "dist/index.html"), "utf8").includes(
      "/favicon.svg",
    ),
  );
});
test("API WebSocket, history and safe rendering are implemented", () => {
  const script = readFileSync(resolve(root, jsFile), "utf8");
  assert.match(script, /\/api\/ws/);
  assert.match(script, /DecompressionStream/);
  assert.match(script, /series=metrics/);
  assert.match(script, /series=ping/);
  assert.match(script, /服务器返回的数据格式错误/);
  assert.match(script, /last_seen_ago/);
  assert.match(script, /重新连接中|重新连接/);
  assert.match(script, /node-page/);
  assert.match(script, /hashchange/);
  assert.match(script, /\/flags\//);
});

test("Simplified Chinese and local SVG flags included", () => {
  const js = readFileSync(resolve(root, jsFile), "utf8");
  for (const term of [
    "节点管理器",
    "CPU",
    "内存",
    "硬盘",
    "在线",
    "离线",
    "网络流量",
    "返回节点列表",
  ])
    assert.ok(js.includes(term), `${term} missing`);
  for (const code of [
    "jp",
    "us",
    "de",
    "sg",
    "cn",
    "hk",
    "tw",
    "ca",
    "ie",
    "il",
    "aq",
  ])
    assert.ok(
      existsSync(resolve(root, `dist/flags/${code}.svg`)),
      `${code}.svg missing`,
    );
});

test("Hub cache safety: hashed JS and CSS match SHA-256 content", async () => {
  const { createHash } = await import("node:crypto");
  for (const p of [jsFile, cssFile]) {
    const file = readFileSync(resolve(root, p));
    const name = p.split("/").at(-1);
    const declared = name.split(".")[1];
    assert.equal(
      createHash("sha256").update(file).digest("hex").slice(0, 16),
      declared,
    );
  }
  assert.ok(!existsSync(resolve(root, "dist/assets/main.js")));
  assert.ok(!existsSync(resolve(root, "dist/assets/styles.css")));
  assert.ok(doc.includes(`content="${manifest.version}"`));
});
