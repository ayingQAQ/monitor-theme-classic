import type { HistoryPoint } from "./types.js";
import { html, valid } from "./format.js";
const chartTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
export function chartSvg(
  points: Array<number | null>,
  label = "CPU（24小时）",
  width = 280,
  height = 90,
  options: {
    hours?: number;
    timestamps?: number[];
    step?: number;
    unit?: string;
    maxValue?: number;
    domain?: [number, number];
  } = {},
): string {
  const data = points.slice(-120);
  const times = options.timestamps?.slice(-120);
  const timed =
    times?.length === data.length &&
    times.every(valid) &&
    times.every((ts, i) => !i || ts >= times[i - 1]);
  const start = options.domain?.[0] ?? (timed ? times![0] : undefined);
  const end = options.domain?.[1] ?? (timed ? times!.at(-1) : undefined);
  const maxValue =
    valid(options.maxValue) && options.maxValue > 0 ? options.maxValue : 100;
  const hasData = data.some(valid);
  const segments: string[] = [];
  let partial: string[] = [];
  data.forEach((v, i) => {
    if (
      timed &&
      i &&
      valid(options.step) &&
      options.step > 0 &&
      times![i] - times![i - 1] > options.step * 1.5 &&
      partial.length
    ) {
      segments.push(partial.join(" "));
      partial = [];
    }
    if (valid(v)) {
      const fraction = timed
        ? end! > start!
          ? (times![i] - start!) / (end! - start!)
          : 0.5
        : i / Math.max(data.length - 1, 1);
      const x = 3 + fraction * (width - 6);
      const y = height - 4 - (Math.min(maxValue, v) / maxValue) * (height - 8);
      partial.push(
        `${partial.length ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`,
      );
    } else if (partial.length) {
      segments.push(partial.join(" "));
      partial = [];
    }
  });
  if (partial.length) segments.push(partial.join(" "));
  const gridX = Array.from(
    { length: 13 },
    (_, i) => `<path d="M${((i * width) / 12).toFixed(1)} 0V${height}"/>`,
  ).join("");
  const gridY = Array.from(
    { length: 5 },
    (_, i) => `<path d="M0 ${((i * height) / 4).toFixed(1)}H${width}"/>`,
  ).join("");
  const stamp = (ts: number) => {
    const date = new Date(ts * 1000);
    return Number.isFinite(date.getTime())
      ? chartTimeFormatter.format(date)
      : "时间未知";
  };
  const left =
    start !== undefined ? stamp(start) : `${options.hours ?? 24} 小时前`;
  const right = end !== undefined ? stamp(end) : "现在";
  const last = [...data].reverse().find(valid);
  return `<div class="graph ${hasData ? "" : "graph-empty"}"><div class="graph-caption"><span>${html(label)}</span><span>${hasData && last !== undefined ? `${last.toFixed(1)}${html(options.unit ?? "%")}` : "暂无历史"}</span></div>
    <div class="graph-plot"><span class="graph-scale graph-scale-top">${maxValue}</span><span class="graph-scale graph-scale-bottom">0</span><svg class="graph-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${html(label)}：${hasData ? "历史趋势" : "暂无历史数据"}"><g class="graph-grid">${gridX}${gridY}</g><g class="graph-line">${segments.map((d) => `<path d="${d}"/>${d.includes("L") ? "" : `<circle cx="${d.slice(1).split(",")[0]}" cy="${d.split(",")[1]}" r="2"/>`}`).join("")}</g></svg>${hasData ? "" : '<span class="graph-no-data">暂无历史数据</span>'}</div>
    <div class="graph-time"><span>${html(left)}</span><span>${html(right)}</span></div></div>`;
}
export function chartFromHistory(
  history: HistoryPoint[] | undefined,
): Array<number | null> {
  if (!Array.isArray(history)) return [];
  return history.map((p) => (p && valid(p.cpu) ? Math.min(100, p.cpu) : null));
}
export function demoChart(seed: number): number[] {
  return Array.from({ length: 72 }, (_, i) => {
    const base =
      10 +
      Math.abs(Math.sin(i * 0.26 + seed * 0.9)) * 9 +
      5 * Math.sin(i * 0.11 + seed);
    const pulse =
      Math.max(0, 1 - Math.abs(i - ((32 + seed * 3) % 60)) / 9) * 22;
    const jitter = Math.abs(Math.sin(i * 9.9 + seed * 13.4)) * 9;
    return Math.max(2, Math.min(88, base + pulse + jitter));
  });
}
