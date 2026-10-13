import test from "node:test";
import assert from "node:assert/strict";
import { nodeState, age, expDays, speed, locationName } from "../src/format.ts";
import { sanitizeNodes, getMe } from "../src/api.ts";
import { chartSvg, chartFromHistory } from "../src/chart.ts";
import { loadConfig, defaults } from "../src/config.ts";
const base = { id: 1, name: "Node", online: true };
test("historical timestamps outside Date's range do not crash chart rendering", () => {
  const markup = chartSvg([20], "CPU", 280, 90, { timestamps: [1e100] });
  assert.ok(markup.includes("时间未知"));
});
test("history uses sample timestamps and breaks missing aggregate intervals", () => {
  const chart = chartSvg([10, 20, 30], "CPU", 106, 90, {
    timestamps: [100, 110, 200],
    step: 10,
  });
  assert.ok(chart.includes("M3.0,") && chart.includes("L13.0,"));
  assert.ok(chart.includes("M103.0,"));
  assert.ok(!chart.includes("L103.0,"));
});
test("invalid metrics have a distinct state from awaiting the first report", () => {
  assert.equal(nodeState({ ...base, metrics: null }), "pending");
  assert.equal(nodeState({ ...base, metrics: { cpu: 20 } }), "invalid");
  assert.equal(nodeState({ ...base, online: false, metrics: null }), "offline");
});
test("malformed optional fields cannot crash a valid node card", () => {
  const [node] = sanitizeNodes([
    { ...base, country: {}, group: [], metrics: { cpu: 20 } },
  ]);
  assert.equal(node.country, undefined);
  assert.equal(node.group, undefined);
  assert.equal(nodeState(node), "invalid");
  assert.equal(sanitizeNodes([{ ...base, id: Infinity }]).length, 0);
});
test("Hub relative age wins over stale last_seen", () => {
  assert.equal(
    age({ ...base, last_seen: null, last_seen_ago: 120 }),
    "2分钟前",
  );
  assert.equal(age({ ...base, last_seen_ago: null }), "从未上报");
  assert.equal(
    expDays({ ...base, expires_in: null, expires_at: "2000-01-01" }),
    null,
  );
  assert.equal(expDays({ ...base, expires_in: NaN }), null);
});
test("charts escape text and give missing history an explicit empty state", () => {
  const chart = chartSvg([null, null], "<img src=x>");
  assert.ok(chart.includes("&lt;img"));
  assert.ok(!chart.includes("<img"));
  assert.ok(chart.includes("暂无历史"));
  assert.deepEqual(
    chartFromHistory([null, { cpu: 15 }, { cpu: "12" }] as never),
    [null, 15, null],
  );
});
test("null configuration falls back to declared defaults", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("null", { status: 200 });
  try {
    assert.deepEqual(await loadConfig(), defaults);
  } finally {
    globalThis.fetch = original;
  }
});
test("missing rate is not an invented zero", () => {
  assert.equal(speed(undefined), "N/A");
  assert.equal(speed(0), "0 b/s");
});
test("network speeds use decimal bit units", () => {
  assert.equal(speed(1_825_000), "14.6 Mb/s");
  assert.equal(speed(125_000_000), "1.0 Gb/s");
});
test("malformed station profile cannot reach the page state", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("null", { status: 200 });
  try {
    await assert.rejects(getMe(), /站点信息格式错误/);
  } finally {
    globalThis.fetch = original;
  }
});

test("Taiwan region uses the configured Chinese name everywhere", () => {
  assert.equal(locationName("TW"), "中国台湾");
  assert.equal(locationName("tw"), "中国台湾");
  assert.equal(locationName("HK"), "中国香港");
  assert.equal(locationName("hk"), "中国香港");
});
