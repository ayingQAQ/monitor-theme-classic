import { test, expect, type Page, type WebSocketRoute } from "@playwright/test";
import { gzipSync } from "node:zlib";
const metrics = {
  cpu: 33,
  uptime: 9000,
  mem_total: 8192,
  mem_used: 4096,
  disk_total: 8192,
  disk_used: 1024,
  net_rx: 1024,
  net_tx: 2048,
};
const node = {
  id: 1,
  name: "Live node",
  country: "JP",
  group: "all",
  online: true,
  metrics,
  last_seen_ago: 5,
  expires_in: 20,
};
test("a fully timed-out last probe cannot hide other successful carrier curves", async ({
  page,
}) => {
  await hub(page, {
    pingHistory: {
      probes: { "1": "电信", "3": "移动" },
      loss: { "3": 100 },
      ping: [
        ...Array.from({ length: 120 }, (_, i) => ({
          task_id: 1,
          ts: 100 + i * 60,
          latency: 40,
        })),
        ...Array.from({ length: 120 }, (_, i) => ({
          task_id: 3,
          ts: 100 + i * 60,
          latency: null,
        })),
      ],
    },
  });
  await page.goto("/#/node/1");
  await page.locator('[data-tab="network"]').click();
  await expect(
    page.locator(".probe-grid .probe-series").first().locator("path"),
  ).toHaveCount(1);
  await expect(page.locator(".probe-grid .graph-no-data")).toHaveCount(0);
});
test("latest timeouts do not reuse old latency or claim a zero loss rate", async ({
  page,
}) => {
  await hub(page, {
    pingHistory: {
      probes: { "1": "电信" },
      ping: [
        { task_id: 1, ts: 100, latency: 40 },
        { task_id: 1, ts: 110, latency: null },
      ],
    },
  });
  await page.goto("/#/node/1");
  await expect(page.locator(".detail-graph .graph-line path")).toHaveCount(1);
  await expect(
    page
      .locator(".properties dt")
      .filter({ hasText: /^延迟$/ })
      .locator("..")
      .locator("dd"),
  ).toHaveText("N/A");
  await page.locator('[data-tab="network"]').click();
  await expect(
    page.locator(".probe-card").filter({ hasText: "电信" }),
  ).toContainText("查询范围丢包率 N/A");
});
test("Hub probe names, timeout and aggregate loss render without invented carrier values", async ({
  page,
}) => {
  await hub(page);
  await page.goto("/#/node/1");
  await page.locator('[data-tab="network"]').click();
  await expect(page.locator(".probe-grid")).toContainText("真实电信");
  await expect(page.locator(".probe-grid")).toContainText("真实联通");
  await expect(page.locator(".probe-grid")).toContainText("12.5%");
  await expect(page.locator(".probe-grid")).toContainText("超时 / 无响应");
  await expect(page.locator(".traffic-block").first()).toContainText("N/A");
});
test("offline nodes retain memory and disk history from hardware totals", async ({
  page,
}) => {
  const backend = await hub(page);
  await page.goto("/#/node/1");
  await expect(page.locator(".detail-header")).toContainText("Live node");
  backend.socket()!.send(
    JSON.stringify({
      nodes: [
        {
          ...node,
          name: "Offline node",
          online: false,
          metrics: null,
          mem_total: 8192,
          disk_total: 8192,
        },
      ],
    }),
  );
  await expect(page.locator(".detail-header")).toContainText("Offline node");
  await page.getByRole("button", { name: "性能监视器" }).click();
  await expect(page.locator(".detail-chart-grid .graph-line path")).toHaveCount(
    3,
  );
});
test("network history errors remain visible with a retry action", async ({
  page,
}) => {
  await hub(page, { historyError: true });
  await page.goto("/#/node/1");
  await page.getByRole("button", { name: "网络流量" }).click();
  await expect(page.locator(".detail-chart-grid")).toContainText(
    "查询历史的请求太多",
  );
  await expect(
    page
      .locator(".detail-chart-grid")
      .getByRole("button", { name: "重试历史" })
      .first(),
  ).toBeVisible();
});
test("realtime updates reuse historical SVGs and refresh still replaces changed charts", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const descriptor = Object.getOwnPropertyDescriptor(
      Element.prototype,
      "innerHTML",
    )!;
    (window as any).__svgMarkupWrites = 0;
    Object.defineProperty(Element.prototype, "innerHTML", {
      ...descriptor,
      set(value) {
        if (
          this instanceof HTMLTemplateElement &&
          String(value).includes("<svg")
        )
          (window as any).__svgMarkupWrites++;
        descriptor.set!.call(this, value);
      },
    });
  });
  const backend = await hub(page);
  await page.goto("/");
  await expect(page.locator(".node-window .graph")).toHaveCount(1);
  await expect(page.locator(".node-window")).toContainText("43 ms");
  await page.evaluate(() => {
    (window as any).__svgMarkupWrites = 0;
  });
  const chart = await page.locator(".node-window .graph-svg").elementHandle();
  backend.socket()!.send(
    JSON.stringify({
      nodes: [{ ...node, metrics: { ...metrics, cpu: 82 } }],
    }),
  );
  await expect(page.locator(".meter-number").first()).toHaveText("82%");
  expect(await page.evaluate(() => (window as any).__svgMarkupWrites)).toBe(0);
  expect(await chart!.evaluate((el) => el.isConnected)).toBe(true);
  await page.route("**/api/nodes/1/metrics?**series=metrics", (route) =>
    route.fulfill({ json: { metrics: [{ ts: 120, cpu: 99 }] } }),
  );
  await page.getByRole("button", { name: "↻ 刷新", exact: true }).click();
  await expect(page.locator(".node-window .graph-caption")).toContainText(
    "99.0%",
  );
  expect(
    await page.evaluate(() => (window as any).__svgMarkupWrites),
  ).toBeGreaterThan(0);
});
test("inserting a connection error keeps cached chart DOM while history refresh is pending", async ({
  page,
}) => {
  const options: Parameters<typeof hub>[1] = {};
  const backend = await hub(page, options);
  try {
    await page.goto("/");
    await expect(page.locator(".node-window .graph-svg")).toHaveCount(1);
    await expect(page.locator(".node-window")).toContainText("43 ms");
    options.holdSeries = "metrics";
    await page.route("**/api/nodes", (route) =>
      route.fulfill({
        status: 500,
        contentType: "text/plain",
        body: "暂时不可用",
      }),
    );
    await page.getByRole("button", { name: "↻ 刷新", exact: true }).click();
    await expect(page.locator(".error-banner")).toContainText("暂时不可用");
    await expect(page.locator(".node-window .graph-svg")).toHaveCount(1);
  } finally {
    backend.releaseHeld();
  }
});
async function hub(
  page: Page,
  options: {
    days?: number;
    historyError?: boolean;
    noSocket?: boolean;
    delayNodes?: boolean;
    config?: unknown;
    pingHistory?: unknown;
    nodes?: (typeof node)[];
    historyDelay?: number;
    limitedHistory?: boolean;
    transientHistory?: boolean;
    holdSeries?: "metrics" | "ping";
  } = {},
) {
  let socket: WebSocketRoute | undefined;
  const historyRequests: string[] = [];
  const requestedNodes: number[] = [];
  let releaseHeld!: () => void;
  const held = new Promise<void>((resolve) => {
    releaseHeld = resolve;
  });
  let activeHistory = 0,
    peakHistory = 0,
    rejectedHistory = 0;
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    let value: unknown = {};
    if (url.pathname === "/api/me")
      value = { site_name: "Test Hub", history_days: options.days ?? 7 };
    else if (url.pathname.includes("/config")) value = options.config ?? {};
    else if (url.pathname === "/api/nodes") {
      if (options.delayNodes)
        await new Promise((resolve) => setTimeout(resolve, 400));
      value = { nodes: options.nodes ?? [node] };
    } else if (url.pathname.endsWith("/metrics")) {
      historyRequests.push(url.search);
      requestedNodes.push(Number(url.pathname.split("/")[3]));
      if (url.searchParams.get("series") === options.holdSeries) await held;
      activeHistory++;
      peakHistory = Math.max(peakHistory, activeHistory);
      const busy =
        (options.limitedHistory && activeHistory > 4) ||
        (options.transientHistory && historyRequests.length === 1);
      if (options.historyDelay)
        await new Promise((resolve) =>
          setTimeout(resolve, options.historyDelay),
        );
      activeHistory--;
      if (busy) {
        rejectedHistory++;
        await route.fulfill({
          status: 503,
          contentType: "text/plain",
          body: "查询历史的请求太多，稍后再试",
        });
        return;
      }
      if (
        options.historyError &&
        url.searchParams.get("series") === "metrics"
      ) {
        await route.fulfill({
          status: 429,
          contentType: "text/plain",
          body: "查询历史的请求太多，稍后再试",
        });
        return;
      }
      value =
        url.searchParams.get("series") === "ping"
          ? (options.pingHistory ?? {
              probes: { "1": "真实电信", "2": "真实联通", "3": "真实移动" },
              loss: { "2": 12.5 },
              ping: [
                { task_id: 1, ts: 100, latency: 40 },
                { task_id: 1, ts: 110, latency: 43 },
                { task_id: 2, ts: 110, latency: null },
                { task_id: 3, ts: 110, latency: 61 },
              ],
            })
          : {
              metrics: [
                {
                  ts: 100,
                  cpu: 15,
                  mem_used: 1024,
                  disk_used: 512,
                  net_rx: 10,
                  net_tx: 20,
                },
                {
                  ts: 110,
                  cpu: 42,
                  mem_used: 2048,
                  disk_used: 1024,
                  net_rx: 20,
                  net_tx: 40,
                },
              ],
            };
    }
    await route.fulfill({ json: value });
  });
  await page.routeWebSocket("**/api/ws**", (ws) => {
    socket = ws;
    if (options.noSocket) ws.close();
    else ws.send(JSON.stringify({ nodes: options.nodes ?? [node] }));
  });
  return {
    socket: () => socket,
    historyRequests,
    requestedNodes,
    releaseHeld,
    peak: () => peakHistory,
    rejected: () => rejectedHistory,
  };
}

test("visible CPU charts do not wait for slow ping history", async ({
  page,
}) => {
  const nodes = Array.from({ length: 19 }, (_, i) => ({
    ...node,
    id: i + 1,
    name: `Node ${i + 1}`,
  }));
  const backend = await hub(page, { nodes, holdSeries: "ping" });
  try {
    await page.goto("/");
    await expect(page.locator(".node-window .graph")).toHaveCount(19, {
      timeout: 2500,
    });
    await expect(page.locator(".node-window").first()).toContainText("N/A");
  } finally {
    backend.releaseHeld();
  }
});

test("latency renders without waiting for resource history", async ({
  page,
}) => {
  const backend = await hub(page, { holdSeries: "metrics" });
  try {
    await page.goto("/");
    await expect(page.locator(".node-window")).toContainText("43 ms", {
      timeout: 2000,
    });
    await expect(page.locator(".history-placeholder")).toHaveCount(1);
  } finally {
    backend.releaseHeld();
  }
});

test("refresh prioritizes currently visible cards after scrolling", async ({
  page,
}) => {
  const nodes = Array.from({ length: 19 }, (_, i) => ({
    ...node,
    id: i + 1,
    name: `Node ${i + 1}`,
  }));
  const backend = await hub(page, { nodes, historyDelay: 50 });
  await page.goto("/");
  await expect(page.locator(".node-window .graph")).toHaveCount(19);
  await expect.poll(() => backend.historyRequests.length).toBe(38);
  const ids = await page.locator(".content").evaluate((el) => {
    el.scrollTop = 900;
    const bounds = el.getBoundingClientRect();
    return Array.from(el.querySelectorAll<HTMLElement>(".node-window"))
      .filter((card) => {
        const rect = card.getBoundingClientRect();
        return rect.bottom > bounds.top && rect.top < bounds.bottom;
      })
      .map((card) => Number(card.dataset.node));
  });
  const before = backend.requestedNodes.length;
  await page.getByRole("button", { name: "↻ 刷新", exact: true }).click();
  await expect
    .poll(() => backend.requestedNodes.length)
    .toBeGreaterThanOrEqual(before + 4);
  expect(
    backend.requestedNodes
      .slice(before, before + 4)
      .every((id) => ids.includes(id)),
  ).toBe(true);
});

test("realtime frames keep scroll containers and cards connected while scrolling", async ({
  page,
}) => {
  const nodes = Array.from({ length: 19 }, (_, i) => ({
    ...node,
    id: i + 1,
    name: `Node ${i + 1}`,
  }));
  const backend = await hub(page, { nodes, historyDelay: 80 });
  await page.goto("/");
  await expect(page.locator(".node-window")).toHaveCount(19);
  const content = await page.locator(".content").elementHandle();
  const tree = await page.locator(".tree-scroll").elementHandle();
  const card = await page.locator(".node-window").first().elementHandle();
  await content!.evaluate((el) => {
    el.scrollTop = 300;
  });
  backend.socket()!.send(
    JSON.stringify({
      nodes: nodes.map((n) => ({ ...n, metrics: { ...metrics, cpu: 82 } })),
    }),
  );
  await expect(page.locator(".meter-number").first()).toHaveText("82%");
  for (const element of [content, tree, card])
    expect(await element!.evaluate((el) => el.isConnected)).toBe(true);
  const box = await page.locator(".content").boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + 150);
  for (let i = 0; i < 5; i++) {
    const before = await content!.evaluate((el) => el.scrollTop);
    backend.socket()!.send(JSON.stringify({ nodes }));
    await page.mouse.wheel(0, 120);
    await expect
      .poll(() => content!.evaluate((el) => el.scrollTop))
      .toBeGreaterThan(before);
  }
});

test("19 nodes and refresh respect Hub's four history slots and retry transient busy responses", async ({
  page,
}) => {
  const nodes = Array.from({ length: 19 }, (_, i) => ({
    ...node,
    id: i + 1,
    name: `Node ${i + 1}`,
  }));
  const backend = await hub(page, {
    nodes,
    historyDelay: 80,
    limitedHistory: true,
    transientHistory: true,
  });
  await page.goto("/");
  await expect(page.locator(".node-window .graph")).toHaveCount(19, {
    timeout: 15000,
  });
  expect(backend.peak()).toBeLessThanOrEqual(4);
  expect(backend.rejected()).toBe(1);
  await page.getByRole("button", { name: "↻ 刷新", exact: true }).click();
  await expect
    .poll(() => backend.historyRequests.length)
    .toBeGreaterThanOrEqual(77);
  await expect(page.locator(".node-window .graph")).toHaveCount(19);
  expect(backend.peak()).toBeLessThanOrEqual(4);
  await expect(page.locator(".history-error")).toHaveCount(0);
});

test("loading history occupies the same card height as a loaded chart", async ({
  page,
}) => {
  await hub(page, { historyDelay: 700 });
  await page.goto("/");
  await expect(page.locator(".history-placeholder")).toHaveCount(1);
  const loading = (await page.locator(".node-window").boundingBox())!.height;
  await expect(page.locator(".node-window .graph")).toHaveCount(1);
  const loaded = (await page.locator(".node-window").boundingBox())!.height;
  expect(Math.abs(loading - loaded)).toBeLessThanOrEqual(1);
});

for (const layout of ["desktop", "compact", "mobile"]) {
  test(`failed history keeps the chart height in ${layout} layout`, async ({
    page,
  }) => {
    await page.setViewportSize({
      width: layout === "mobile" ? 540 : 1280,
      height: 900,
    });
    const options = { historyError: true };
    await hub(page, options);
    await page.goto("/");
    if (layout === "compact")
      await page.locator("#view-select").selectOption("compact");
    await expect(page.locator(".history-error")).toHaveCount(1);
    const failed = (await page.locator(".node-window").boundingBox())!.height;
    options.historyError = false;
    await page.getByRole("button", { name: "↻ 刷新", exact: true }).click();
    await expect(page.locator(".node-window .graph")).toHaveCount(1);
    const loaded = (await page.locator(".node-window").boundingBox())!.height;
    expect(Math.abs(failed - loaded)).toBeLessThanOrEqual(1);
  });
}

test("region names stay consistent across sidebar cards and details", async ({
  page,
}) => {
  await hub(page, {
    nodes: [
      { ...node, country: "TW" },
      { ...node, id: 2, country: "HK" },
    ],
  });
  await page.goto("/");
  for (const [id, name] of [
    [1, "中国台湾"],
    [2, "中国香港"],
  ] as const) {
    await expect(
      page.locator(`.nav-row[data-scope="country:${id === 1 ? "TW" : "HK"}"]`),
    ).toContainText(name);
    await expect(page.locator(`.node-window[data-node="${id}"]`)).toContainText(
      name,
    );
    await page.goto(`/#/node/${id}`);
    await expect(page.locator(".detail-header")).toContainText(name);
    await expect(page.locator(".detail-header")).not.toContainText(
      "特别行政区",
    );
    await page.goto("/");
  }
});

test("text and gzip updates preserve search selection and card control focus", async ({
  page,
}) => {
  const backend = await hub(page);
  await page.goto("/");
  await expect(page.locator(".node-window")).toHaveCount(1);
  await page.locator("#search-box").fill("Live");
  await page
    .locator("#search-box")
    .evaluate((input: HTMLInputElement) => input.setSelectionRange(1, 3));
  backend.socket()!.send(
    gzipSync(
      JSON.stringify({
        nodes: [{ ...node, metrics: { ...metrics, cpu: 71 } }],
      }),
    ),
  );
  backend.socket()!.send(
    JSON.stringify({
      nodes: [{ ...node, metrics: { ...metrics, cpu: 82 } }],
    }),
  );
  await expect(page.locator(".meter-number").first()).toHaveText("82%");
  expect(
    await page
      .locator("#search-box")
      .evaluate((input: HTMLInputElement) => [
        input.selectionStart,
        input.selectionEnd,
      ]),
  ).toEqual([1, 3]);
  await page.locator('[data-action="min"]').focus();
  backend.socket()!.send(
    JSON.stringify({
      nodes: [{ ...node, metrics: { ...metrics, cpu: 83 } }],
    }),
  );
  await expect(page.locator(".meter-number").first()).toHaveText("83%");
  await expect(page.locator('[data-action="min"]')).toBeFocused();
});
test("HTTP response started before a live update cannot replace the newer snapshot", async ({
  page,
}) => {
  const backend = await hub(page, { delayNodes: true });
  await page.goto("/");
  await expect(page.locator(".node-window")).toHaveCount(1);
  backend
    .socket()!
    .send(JSON.stringify({ nodes: [{ ...node, name: "New snapshot" }] }));
  await expect(page.locator(".node-title")).toContainText("New snapshot");
  await page.waitForTimeout(650);
  await expect(page.locator(".node-title")).toContainText("New snapshot");
});
test("direct detail entry shows loading then resolved node, history range follows retention", async ({
  page,
}) => {
  const backend = await hub(page, { days: 2, delayNodes: true });
  await page.goto("/#/node/1");
  await expect(page.locator(".detail-inner")).not.toContainText("未找到");
  await expect(page.locator(".detail-header")).toContainText("Live node");
  await expect(page.locator("#history-range option")).toHaveText([
    "1 小时",
    "6 小时",
    "1 天",
    "2 天",
  ]);
  await page.locator("#history-range").selectOption("48");
  await expect
    .poll(() => backend.historyRequests.some((q) => q.includes("hours=48")))
    .toBe(true);
  await expect(page.locator(".detail-graph .graph-time")).toContainText("01/");
});
test("history failures stay visible and refresh retries the history query", async ({
  page,
}) => {
  const backend = await hub(page, { historyError: true });
  await page.goto("/#/node/1");
  await expect(page.locator(".detail-sections .history-error")).toContainText(
    "查询历史的请求太多",
  );
  const before = backend.historyRequests.filter((q) =>
    q.includes("series=metrics"),
  ).length;
  await page.locator('.detail-sections [data-action="refresh"]').click();
  await expect
    .poll(
      () =>
        backend.historyRequests.filter((q) => q.includes("series=metrics"))
          .length,
    )
    .toBeGreaterThan(before);
});
test("unavailable WebSocket falls back to HTTP polling without pretending to be live", async ({
  page,
}) => {
  await hub(page, { noSocket: true });
  await page.goto("/");
  await expect(page.locator(".node-window")).toHaveCount(1);
  await expect(page.locator(".status-ready")).toContainText("轮询中");
  await expect(page.locator(".status-ready")).not.toContainText("实时连接");
});
test("Hub authorization errors are readable, proxy HTML never enters the page", async ({
  page,
}) => {
  await page.routeWebSocket("**/api/ws**", (ws) => ws.close());
  await page.route("**/api/**", (route) =>
    route.fulfill({
      status: 401,
      contentType: "text/plain",
      body: "需要登录后查看",
    }),
  );
  await page.goto("/");
  await expect(page.locator(".error-banner")).toContainText("需要登录后查看");
  await expect(page.locator(".empty-state")).toContainText("暂时无法连接站点");
  await page.unroute("**/api/**");
  await page.route("**/api/**", (route) =>
    route.fulfill({
      status: 502,
      contentType: "text/html",
      body: "<h1>PRIVATE PROXY RESPONSE</h1>",
    }),
  );
  await page.locator(".error-banner button").click();
  await expect(page.locator(".error-banner")).toContainText("HTTP 502");
  await expect(page.locator("body")).not.toContainText(
    "PRIVATE PROXY RESPONSE",
  );
});
test("blocked local storage and broken optional configuration keep the console usable", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("blocked");
      },
    }),
  );
  await hub(page, {
    config: {
      columns: 99,
      notice: "<img src=x onerror=alert(1)>",
      show_sidebar: false,
    },
  });
  await page.goto("/");
  await expect(page.locator(".node-window")).toHaveCount(1);
  await expect(page.locator(".notice")).toContainText("<img src=x");
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  await page.locator('[data-action="toggle-sidebar"]').first().click();
  await page.locator('[data-modal="settings"]').click();
  await page.locator("#pref-compact").check();
  await expect(page.locator("#pref-compact")).toBeChecked();
});

test("expired access clears previously displayed private node data", async ({
  page,
}) => {
  const backend = await hub(page);
  await page.goto("/");
  await expect(page.locator(".node-window")).toHaveCount(1);
  backend.socket()!.close();
  await page.route("**/api/nodes", (route) =>
    route.fulfill({
      status: 401,
      contentType: "text/plain",
      body: "需要登录后查看",
    }),
  );
  await page.locator('.desktop-actions [data-action="refresh"]').click();
  await expect(page.locator(".error-banner")).toContainText("需要登录后查看");
  await expect(page.locator(".node-window")).toHaveCount(0);
});

test("a stalled stream is replaced and unreadable frames never keep it alive", async ({
  page,
}) => {
  await page.clock.install();
  const backend = await hub(page);
  await page.goto("/");
  await expect(page.locator(".node-window")).toHaveCount(1);
  const old = backend.socket();
  old!.send("not JSON");
  await page.clock.fastForward(12_000);
  await expect.poll(() => backend.socket() !== old).toBe(true);
  await expect(page.locator(".status-ready")).toContainText("实时连接");
});

test("monthly consumption is not guessed from receive and send counters", async ({
  page,
}) => {
  const backend = await hub(page);
  await page.goto("/#/node/1");
  await expect(page.locator(".detail-header")).toBeVisible();
  backend.socket()!.send(
    JSON.stringify({
      nodes: [
        {
          ...node,
          name: "Traffic node",
          month_rx: 3000,
          month_tx: 4000,
          traffic_mode: "max",
        },
      ],
    }),
  );
  await expect(page.locator(".detail-header")).toContainText("Traffic node");
  await page.locator('[data-tab="network"]').click();
  await expect(
    page
      .locator(".properties div")
      .filter({ has: page.locator("dt", { hasText: "本月已用流量（Hub）" }) })
      .locator("dd"),
  ).toHaveText("N/A");
});
