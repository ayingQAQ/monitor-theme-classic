import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
const root = join(import.meta.dirname, "..");
const label = process.argv[2] || "current";
if (!/^[a-z0-9-]+$/i.test(label)) throw new Error("Invalid report label");
const server = spawn(process.execPath, [join(root, "scripts/serve.mjs")], {
  cwd: root,
  env: { ...process.env, PORT: "4181" },
  stdio: "ignore",
  windowsHide: true,
});
let browser;
try {
  const deadline = Date.now() + 10000;
  while (true) {
    try {
      if ((await fetch("http://127.0.0.1:4181/")).ok) break;
    } catch {}
    if (server.exitCode !== null || Date.now() > deadline)
      throw new Error("Measurement server unavailable");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  browser = await chromium.launch();
  const reports = [];
  for (const count of [19, 100]) {
    const metrics = {
      cpu: 20,
      uptime: 1000,
      mem_total: 8192,
      mem_used: 1024,
      disk_total: 8192,
      disk_used: 2048,
      net_rx: 512,
      net_tx: 256,
    };
    const nodes = Array.from({ length: count }, (_, i) => ({
      id: i + 1,
      name: `Node ${i + 1}`,
      online: true,
      country: ["JP", "HK", "TW"][i % 3],
      group: `Group ${i % 4}`,
      metrics,
    }));
    const rows = Array.from({ length: 120 }, (_, i) => ({
      ts: 172800 + i * 720,
      cpu: 20 + Math.sin(i) * 5,
      mem_used: 1024,
      disk_used: 2048,
    }));
    const page = await browser.newPage({
      viewport: { width: 1920, height: 1200 },
    });
    await page.addInitScript(() => {
      window.__performanceReport = { frames: [], names: 0, stamps: 0 };
      const report = window.__performanceReport;
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (callback) =>
        raf((time) => {
          const start = performance.now();
          callback(time);
          report.frames.push(performance.now() - start);
        });
      Intl.DisplayNames = new Proxy(Intl.DisplayNames, {
        construct(target, args) {
          report.names++;
          return Reflect.construct(target, args);
        },
      });
      const stamp = Date.prototype.toLocaleString;
      Date.prototype.toLocaleString = function (...args) {
        report.stamps++;
        return stamp.apply(this, args);
      };
      const descriptor = Object.getOwnPropertyDescriptor(
        Intl.DateTimeFormat.prototype,
        "format",
      );
      Object.defineProperty(Intl.DateTimeFormat.prototype, "format", {
        ...descriptor,
        get() {
          const format = descriptor.get.call(this);
          return (...args) => {
            report.stamps++;
            return format(...args);
          };
        },
      });
    });
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      const value =
        url.pathname === "/api/me"
          ? { history_days: 7 }
          : url.pathname === "/api/nodes"
            ? { nodes }
            : url.pathname.endsWith("/metrics")
              ? url.searchParams.get("series") === "metrics"
                ? { metrics: rows, step: 720 }
                : {
                    ping: rows.map((p) => ({
                      ts: p.ts,
                      task_id: 1,
                      latency: 30,
                    })),
                    probes: { 1: "电信" },
                    step: 720,
                  }
              : {};
      await route.fulfill({ json: value });
    });
    let socket;
    await page.routeWebSocket("**/api/ws**", (ws) => {
      socket = ws;
      ws.send(JSON.stringify({ nodes }));
    });
    await page.goto("http://127.0.0.1:4181/");
    await page.waitForFunction(
      (n) => document.querySelectorAll(".node-window .graph").length === n,
      count,
    );
    await page.waitForFunction(
      (n) =>
        Array.from(
          document.querySelectorAll(".node-window .card-facts"),
        ).filter((el) => el.textContent.includes("30 ms")).length === n,
      count,
    );
    await page.evaluate(() => {
      Object.assign(window.__performanceReport, {
        frames: [],
        names: 0,
        stamps: 0,
      });
    });
    for (let i = 30; i < 60; i++) {
      socket.send(
        JSON.stringify({
          nodes: nodes.map((n) => ({ ...n, metrics: { ...metrics, cpu: i } })),
        }),
      );
      await page.waitForFunction(
        (value) =>
          document.querySelector(".meter-number")?.textContent === `${value}%`,
        i,
      );
    }
    const result = await page.evaluate(() => window.__performanceReport);
    const frames = result.frames.sort((a, b) => a - b);
    reports.push({
      nodes: count,
      updates: 30,
      renderMedianMs: frames[Math.floor(frames.length / 2)],
      renderP95Ms: frames[Math.floor(frames.length * 0.95)],
      regionFormatterConstructions: result.names,
      chartTimestampFormats: result.stamps,
    });
    await page.close();
  }
  await mkdir(join(root, "test-results"), { recursive: true });
  await writeFile(
    join(root, `test-results/performance-${label}.json`),
    JSON.stringify(reports, null, 2) + "\n",
  );
  console.log(JSON.stringify(reports, null, 2));
} finally {
  await browser?.close();
  server.kill();
}
