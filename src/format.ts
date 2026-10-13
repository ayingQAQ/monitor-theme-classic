import type { NodeInfo, Metrics } from "./types.js";
export const valid = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= 0;
export const percent = (used: unknown, total: unknown): number | null =>
  valid(used) && valid(total) && total > 0
    ? Math.min(100, Math.max(0, (used / total) * 100))
    : null;
export const cpuValue = (n: NodeInfo): number | null =>
  valid(n.metrics?.cpu) ? Math.min(100, n.metrics!.cpu!) : null;
export const ramValue = (n: NodeInfo): number | null =>
  percent(n.metrics?.mem_used, n.metrics?.mem_total ?? n.mem_total);
export const diskValue = (n: NodeInfo): number | null =>
  percent(n.metrics?.disk_used, n.metrics?.disk_total ?? n.disk_total);
export const fmtPercent = (n: number | null): string =>
  n === null ? "N/A" : `${n.toFixed(n % 1 === 0 ? 0 : 1)}%`;
export function bytes(value: number | undefined | null, digits = 1): string {
  if (!valid(value)) return "N/A";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let i = 0;
  let v = value;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i ? digits : 0)} ${units[i]}`;
}
export function speed(value: number | undefined | null): string {
  if (!valid(value)) return "N/A";
  let bits = value * 8;
  if (!Number.isFinite(bits)) return "N/A";
  const units = ["b/s", "Kb/s", "Mb/s", "Gb/s", "Tb/s", "Pb/s"];
  let i = 0;
  while (bits >= 1000 && i < units.length - 1) {
    bits /= 1000;
    i++;
  }
  return `${bits.toFixed(i ? 1 : 0)} ${units[i]}`;
}
export function duration(seconds: number | undefined | null): string {
  if (!valid(seconds)) return "N/A";
  const d = Math.floor(seconds / 86400),
    h = Math.floor((seconds % 86400) / 3600),
    m = Math.floor((seconds % 3600) / 60);
  return d > 0 ? `${d}天${h}小时` : h > 0 ? `${h}小时${m}分钟` : `${m}分钟`;
}
export function age(n: NodeInfo): string {
  if (n.last_seen_ago === null) return "从未上报";
  if (
    n.last_seen_ago === undefined &&
    (n.last_seen === 0 || n.last_seen === null)
  )
    return "从未上报";
  const secs =
    n.last_seen_ago !== undefined
      ? valid(n.last_seen_ago)
        ? n.last_seen_ago
        : null
      : valid(n.last_seen)
        ? Math.max(0, Date.now() / 1000 - n.last_seen)
        : null;
  return secs === null ? "未知" : `${duration(secs)}前`;
}
export function expDays(n: NodeInfo): number | null {
  if (n.expires_in !== undefined)
    return typeof n.expires_in === "number" && Number.isFinite(n.expires_in)
      ? n.expires_in
      : null;
  if (!n.expires_at) return null;
  const date = new Date(n.expires_at);
  if (!Number.isFinite(date.getTime())) return null;
  return Math.ceil((date.getTime() - Date.now()) / 86400000);
}
export function nodeState(
  n: NodeInfo,
): "online" | "offline" | "pending" | "warning" | "invalid" {
  if (!n.online) return "offline";
  if (n.metrics === null || n.metrics === undefined) return "pending";
  if (!isMetricGood(n.metrics)) return "invalid";
  const d = expDays(n);
  if (
    (cpuValue(n) ?? 0) > 90 ||
    (ramValue(n) ?? 0) > 90 ||
    (diskValue(n) ?? 0) > 90 ||
    (d !== null && d <= 3)
  )
    return "warning";
  return "online";
}
export function isMetricGood(m: Metrics | null | undefined): boolean {
  if (!m) return false;
  return [
    "cpu",
    "uptime",
    "mem_used",
    "mem_total",
    "disk_used",
    "disk_total",
    "net_rx",
    "net_tx",
  ].every((k) => valid(m[k as keyof Metrics]));
}
export function html(s: unknown): string {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] ?? c,
  );
}
let regionFormatter: Intl.DisplayNames | undefined;
const regionLabels = new Map<string, string>();
export function locationName(code?: string): string {
  if (!code) return "未知地区";
  const region = code.toUpperCase();
  if (region === "TW") return "中国台湾";
  if (region === "HK") return "中国香港";
  const cached = regionLabels.get(region);
  if (cached !== undefined) return cached;
  try {
    regionFormatter ??= new Intl.DisplayNames(["zh-CN"], { type: "region" });
    const label = regionFormatter.of(region) || region;
    if (regionLabels.size >= 256)
      regionLabels.delete(regionLabels.keys().next().value!);
    regionLabels.set(region, label);
    return label;
  } catch {
    return region;
  }
}
export const countryFlag = (code?: string): string =>
  code && /^[a-z]{2}$/i.test(code)
    ? [...code.toUpperCase()]
        .map((char) => String.fromCodePoint(char.charCodeAt(0) + 127397))
        .join("")
    : "🌐";
