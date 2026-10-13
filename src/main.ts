import type {
  NodeInfo,
  NodeHistory,
  PingHistory,
  Me,
  ThemeConfig,
} from "./types.js";
import { NodeStream, getHistory, getPing, getMe } from "./api.js";
import { loadConfig, defaults } from "./config.js";
import {
  age,
  bytes,
  cpuValue,
  diskValue,
  duration,
  expDays,
  fmtPercent,
  html,
  locationName,
  nodeState,
  ramValue,
  speed,
  valid,
} from "./format.js";
import { chartSvg, chartFromHistory, demoChart } from "./chart.js";
import { updateMarkup } from "./dom.js";
const root = document.getElementById("app")!;
const buildVersion =
  document.querySelector<HTMLMetaElement>(
    'meta[name="monitor-classic-version"]',
  )?.content || "开发版";
const demo = (window as Window & { __X86_DEMO_NODES__?: NodeInfo[] })
  .__X86_DEMO_NODES__;
const isDemo = Array.isArray(demo);
const history = new Map<
  string,
  {
    data: Array<number | null>;
    ping: number | null;
    time: number;
    raw?: NodeHistory;
    error?: string;
    probes?: PingHistory;
    pingError?: string;
    pingTime?: number;
  }
>();
const inFlight = new Set<string>();
// Hub shares four slots across both series; each slot now tracks one request.
const historyRequestLimit = 4;
let historyHours = 24;
let historyEpoch = 0;
const historyKey = (id: number) => `${id}:${historyHours}`;
const cachedHistory = (id: number) => history.get(historyKey(id));
let nodes: NodeInfo[] | null = null;
let error: string | null = null;
let refreshed: number | null = null;
let connection = "连接中";
let config: ThemeConfig = defaults;
let me: Me = {};
let scope = "all";
let search = "";
let view: "cards" | "compact" = "cards";
let sidebarOpen = window.innerWidth > 700;
let preferredSidebar: boolean | undefined;
const collapsedTrees = new Set<string>();
function treeHeading(id: string, label: string, icon: string) {
  return `<button type="button" id="tree-heading-${id}" class="tree-parent tree-folder-toggle" data-action="toggle-tree" data-tree="${id}" aria-expanded="${!collapsedTrees.has(id)}" aria-controls="tree-children-${id}"><span class="tree-toggle" aria-hidden="true">${collapsedTrees.has(id) ? "+" : "−"}</span>${icon}<span>${label}</span></button>`;
}
function navigationToggle() {
  const expanded = sidebarOpen && (preferredSidebar ?? config.show_sidebar);
  return `<button type="button" id="navigation-toggle" class="classic-button navigation-toggle" data-action="toggle-sidebar" aria-label="${expanded ? "收起" : "展开"}节点管理器" aria-expanded="${expanded}" title="${expanded ? "收起" : "展开"}节点管理器">${buttonIcon("computer")}</button>`;
}
try {
  const prefs = JSON.parse(
    localStorage.getItem("monitor-classic.preferences") || "{}",
  );
  if (prefs?.view === "compact") view = "compact";
  if (typeof prefs?.sidebar === "boolean") preferredSidebar = prefs.sidebar;
} catch {}
function savePreferences() {
  try {
    localStorage.setItem(
      "monitor-classic.preferences",
      JSON.stringify({ view, sidebar: preferredSidebar }),
    );
  } catch {}
}
const minimized = new Set<number>();
const hidden = new Set<number>();
let modal: { type: "network" | "performance" | "alerts" | "settings" } | null =
  null;
let detailTab: "overview" | "performance" | "network" | "hardware" = "overview";
let previousRoute = "";
let listScroll = 0;
let lastOpenedId: number | null = null;
let modalOpener = "";
let retryTimer: ReturnType<typeof setInterval> | null = null;
const client = new NodeStream((next, err, last, conn) => {
  nodes = next;
  error = err;
  refreshed = last;
  connection = conn;
  scheduleRender();
  if (config.show_chart || detailId() !== null) void loadVisibleHistories();
});
function buttonIcon(type: string): string {
  const icons: Record<string, string> = {
    computer:
      '<span class="pixel-pc" aria-hidden="true"><span class="pc-screen"></span><span class="pc-base"></span></span>',
    globe: '<span class="pixel-globe" aria-hidden="true">🌐</span>',
    folder: '<span class="pixel-folder" aria-hidden="true">📁</span>',
    report: '<span class="pixel-tool" aria-hidden="true">📊</span>',
    warning: '<span class="pixel-tool" aria-hidden="true">⚠️</span>',
    settings: '<span class="pixel-tool" aria-hidden="true">🔧</span>',
  };
  return icons[type] || icons.computer;
}

// Self-contained flag SVGs prevent Windows from rendering regional flags as letter pairs.
const bundledFlags = new Set(
  "jp de fr it ie be nl ru at pl ua id sg vn ch cn hk tw kr us gb ca se fi no dk ae th es in tr il aq".split(
    " ",
  ),
);
function flagImage(code?: string, klass = "node-flag"): string {
  const c = typeof code === "string" ? code.toLowerCase() : "";
  if (bundledFlags.has(c))
    return `<img class="${klass}" src="/flags/${c}.svg" alt="${html(locationName(c))}国旗" loading="lazy" decoding="async" />`;
  return `<span class="${klass} flag-fallback" title="${html(locationName(code))}">${html(c.toUpperCase() || "??")}</span>`;
}
const stateZh = (status: string) =>
  status === "online"
    ? "在线"
    : status === "warning"
      ? "告警"
      : status === "pending"
        ? "等待上报"
        : status === "invalid"
          ? "指标异常"
          : "离线";
function detailId(): number | null {
  const m = location.hash.match(/^#\/node\/(\d+)$/);
  return m && Number.isSafeInteger(Number(m[1])) ? Number(m[1]) : null;
}
function openDetail(id: number) {
  detailTab = "overview";
  lastOpenedId = id;
  if (window.innerWidth <= 700) sidebarOpen = false;
  if (detailId() !== id)
    window.history.pushState(
      { x86FromList: detailId() === null },
      "",
      `${location.pathname}${location.search}#/node/${id}`,
    );
  render();
  focusRoute();
}
function closeDetail() {
  if (window.history.state?.x86FromList) {
    window.history.back();
    return;
  }
  window.history.replaceState(
    null,
    "",
    `${location.pathname}${location.search}#/nodes`,
  );
  render();
  focusRoute();
}
function focusRoute() {
  if (detailId() === null) {
    root
      .querySelector<HTMLElement>(`[data-node="${lastOpenedId}"]`)
      ?.focus({ preventScroll: true });
  } else {
    const page = root.querySelector<HTMLElement>(".node-page");
    if (page) {
      page.tabIndex = -1;
      page.focus({ preventScroll: true });
    }
  }
}
const groups = (list: NodeInfo[]) => [
  ...new Set(list.map((n) => n.group || "").filter(Boolean)),
];
const countries = (list: NodeInfo[]) => [
  ...new Set(list.map((n) => n.country || "").filter(Boolean)),
];
function counts() {
  const a = nodes || [];
  return {
    all: a.length,
    online: a.filter((n) => n.online).length,
    offline: a.filter((n) => !n.online).length,
    warning: a.filter(
      (n) => nodeState(n) === "warning" || nodeState(n) === "invalid",
    ).length,
    pending: a.filter((n) => nodeState(n) === "pending").length,
  };
}
function match(n: NodeInfo, s: string): boolean {
  const st = nodeState(n);
  if (s === "online") return n.online;
  if (s === "offline") return !n.online;
  if (s === "warning") return st === "warning" || st === "invalid";
  if (s === "pending") return st === "pending";
  if (s.startsWith("country:")) return n.country === s.slice(8);
  if (s.startsWith("group:")) return (n.group || "") === s.slice(6);
  if (s === "ungrouped") return !(n.group || "");
  return true;
}
function visible() {
  return (nodes || []).filter(
    (n) =>
      match(n, scope) &&
      !hidden.has(n.id) &&
      [n.name, n.country, n.group, n.public_remark]
        .join(" ")
        .toLowerCase()
        .includes(search.toLowerCase().trim()),
  );
}
function scopeText() {
  if (scope === "online") return "在线节点";
  if (scope === "offline") return "离线节点";
  if (scope === "warning") return "告警节点";
  if (scope === "pending") return "等待数据";
  if (scope.startsWith("country:")) return locationName(scope.slice(8));
  if (scope.startsWith("group:")) return scope.slice(6);
  if (scope === "ungrouped") return "未分组";
  return "全部节点";
}
function navRow(
  label: string,
  id: string,
  icon: string,
  count?: number,
  depth = 1,
) {
  return `<button type="button" class="nav-row ${scope === id ? "selected" : ""}" style="--indent:${depth}" data-scope="${html(id)}" title="${html(label)}" aria-pressed="${scope === id}">${icon}<span class="nav-text">${html(label)}${count !== undefined ? ` (${count})` : ""}</span></button>`;
}
function renderSidebar() {
  if (!(preferredSidebar ?? config.show_sidebar)) return "";
  const a = nodes || [];
  const n = counts();
  return `<aside class="sidebar ${!sidebarOpen ? "sidebar-closed" : ""}" aria-label="节点导航">
    <div class="sidebar-title classic-title"><span>${html(config.site_label || "节点管理器")}</span><button data-action="collapse-sidebar" aria-label="折叠导航" class="title-btn">${sidebarOpen ? "−" : "+"}</button></div>
    <div class="tree-scroll"><div class="tree-group">
    ${treeHeading("nodes", "节点", buttonIcon("computer"))}<div id="tree-children-nodes" ${collapsedTrees.has("nodes") ? "hidden" : ""}>
    ${navRow("全部节点", "all", buttonIcon("computer"), n.all)}
    ${navRow("在线", "online", '<span class="status-dot online"></span>', n.online, 2)}
    ${navRow("离线", "offline", '<span class="status-dot offline"></span>', n.offline, 2)}
    ${navRow("告警", "warning", '<span class="status-dot warning"></span>', n.warning, 2)}
    ${n.pending ? navRow("等待上报", "pending", '<span class="status-dot pending"></span>', n.pending, 2) : ""}
    </div></div><div class="tree-group">${treeHeading("countries", "按地区", buttonIcon("folder"))}<div id="tree-children-countries" ${collapsedTrees.has("countries") ? "hidden" : ""}>
    ${countries(a)
      .map((c) =>
        navRow(
          `${locationName(c)}`,
          `country:${c}`,
          flagImage(c, "tree-flag"),
          a.filter((n) => n.country === c).length,
        ),
      )
      .join("")}
    </div></div><div class="tree-group">${treeHeading("groups", "分组", buttonIcon("folder"))}<div id="tree-children-groups" ${collapsedTrees.has("groups") ? "hidden" : ""}>
    ${groups(a)
      .map((g) =>
        navRow(
          g,
          `group:${g}`,
          buttonIcon("folder"),
          a.filter((n) => n.group === g).length,
        ),
      )
      .join("")}
    ${a.some((n) => !n.group) ? navRow("未分组", "ungrouped", buttonIcon("folder"), a.filter((n) => !n.group).length) : ""}
    </div></div><div class="tree-tools">
    <button data-modal="network">${buttonIcon("globe")}<span>网络概览</span></button>
    <button data-modal="performance">${buttonIcon("report")}<span>性能概览</span></button>
    <button data-modal="alerts">${buttonIcon("warning")}<span>告警状态</span></button>
    <button data-modal="settings">${buttonIcon("settings")}<span>显示设置</span></button>
    </div></div></aside>`;
}
function meter(name: string, v: number | null, meta?: string) {
  return `<div class="meter-row"><span class="meter-label">${html(name)}</span><span class="meter-number">${fmtPercent(v)}</span><div class="meter-wrap"><span class="meter-fill ${v !== null && v > 90 ? "meter-danger" : ""}" style="width:${v ?? 0}%"></span></div>${meta ? `<span class="meter-extra">${html(meta)}</span>` : ""}</div>`;
}
function pingText(node: NodeInfo) {
  const cached = cachedHistory(node.id);
  if (isDemo) {
    return `${(node as NodeInfo & { _demoPing?: number })._demoPing ?? "N/A"} ms`;
  }
  return cached?.ping !== null && cached?.ping !== undefined
    ? `${Math.round(cached.ping)} ms`
    : "N/A";
}
type StaticChart = {
  key: string;
  markup: string;
  opening: string;
  hours: number;
  node: number;
};
const historicalCharts = new WeakMap<NodeHistory, StaticChart>();
const demoCharts = new Map<string, StaticChart>();
let chartRevision = 0;
let existingCharts = new Set<string>();
function cacheChart(markup: string, node: number): StaticChart {
  const key = `chart-${node}-${++chartRevision}`;
  const tagged = markup.replace(
    '<div class="graph',
    `<div data-static-key="${key}" class="graph`,
  );
  return {
    key,
    markup: tagged,
    opening: tagged.slice(0, tagged.indexOf(">") + 1),
    hours: historyHours,
    node,
  };
}
function reuseChart(chart: StaticChart): string {
  return existingCharts.has(chart.key)
    ? `${chart.opening}</div>`
    : chart.markup;
}
function nodeChart(n: NodeInfo): string {
  if (!config.show_chart) return "";
  const cached = cachedHistory(n.id);
  const label = `CPU · ${rangeLabel(historyHours)}`;
  if (
    isDemo &&
    n.online &&
    nodeState(n) !== "invalid" &&
    nodeState(n) !== "pending"
  ) {
    const key = `${n.id}:${historyHours}`;
    let chart = demoCharts.get(key);
    if (!chart) {
      chart = cacheChart(
        chartSvg(demoChart(n.id), label, 280, 90, { hours: historyHours }),
        n.id,
      );
      if (demoCharts.size >= 128)
        demoCharts.delete(demoCharts.keys().next().value!);
      demoCharts.set(key, chart);
    }
    return reuseChart(chart);
  }
  if (!isDemo && !cached?.raw && !cached?.error)
    return `<div class="history-placeholder">${inFlight.has(`${historyKey(n.id)}:metrics`) ? "正在加载历史…" : "等待历史数据"}</div>`;
  if (cached?.error)
    return `<div class="history-placeholder history-error" title="${html(cached.error)}">历史暂不可用 · 点击查看详情</div>`;
  if (cached?.raw) {
    let chart = historicalCharts.get(cached.raw);
    if (!chart || chart.hours !== historyHours || chart.node !== n.id) {
      chart = cacheChart(
        chartSvg(cached.data, label, 280, 90, {
          hours: historyHours,
          timestamps: cached.raw.metrics?.map((p) => p.ts),
          step: cached.raw.step,
        }),
        n.id,
      );
      historicalCharts.set(cached.raw, chart);
    }
    return reuseChart(chart);
  }
  return chartSvg(cached?.data ?? [], label, 280, 90, {
    hours: historyHours,
    timestamps: cached?.raw?.metrics?.map((p) => p.ts),
    step: cached?.raw?.step,
  });
}
function nodeCard(n: NodeInfo) {
  const status = nodeState(n),
    cp = cpuValue(n),
    rm = ramValue(n),
    dk = diskValue(n);
  const isMin = minimized.has(n.id);
  const note =
    status === "offline"
      ? "最后上报：" + age(n)
      : status === "pending"
        ? "等待首次指标上报"
        : status === "invalid"
          ? "上报指标不完整或格式异常"
          : "";
  const expires = expDays(n);
  return `<article class="node-window ${status === "offline" ? "card-offline" : ""} ${view === "compact" ? "card-compact" : ""}" data-node="${n.id}" tabindex="0" aria-label="查看 ${html(n.name)} 的节点详情">
    <div class="node-title classic-title"><span class="tiny-pc">${flagImage(n.country, "title-flag")}</span><span class="truncate" title="${html(n.name)}">${html(n.name)}</span><div class="window-actions">
      <button class="title-btn" data-action="min" data-id="${n.id}" title="${isMin ? "还原" : "最小化"}" aria-label="${isMin ? "还原" : "最小化"} ${html(n.name)}">${isMin ? "□" : "−"}</button>
      <button class="title-btn" data-action="detail" data-id="${n.id}" title="查看节点详情" aria-label="查看 ${html(n.name)} 详情">□</button>
      <button class="title-btn" data-action="hide" data-id="${n.id}" title="隐藏卡片" aria-label="隐藏 ${html(n.name)}">×</button>
    </div></div>
    ${
      isMin
        ? ""
        : `<div class="node-body" data-key="node-body-${n.id}">
      <div class="node-identity"><div class="identity-text"><strong>${html(locationName(n.country))}</strong><div class="country-label" title="${html(n.group || "未分组")}">${html(n.group || "未分组")} · #${String(n.id).padStart(2, "0")}</div></div><div class="online-label ${status}"><span class="status-dot ${status}"></span>${stateZh(status)}</div></div>
      <div class="node-note ${note ? "state-note" : ""}" title="${html(note || n.public_remark || "")}">${html(note || n.public_remark || "实时资源监控")}</div>
      <div class="bevel-line"></div>
      <div class="meters">${meter("处理器", cp)}${meter("内存", rm, valid(n.metrics?.mem_used) ? bytes(n.metrics!.mem_used) : undefined)}${meter("硬盘", dk)}${config.show_traffic ? trafficMeter(n) : ""}</div>
      ${nodeChart(n)}
      <div class="card-facts"><div class="fact"><span>延迟</span><strong>${pingText(n)}</strong></div><div class="fact"><span>运行时间</span><strong>${duration(n.metrics?.uptime)}</strong></div>
      ${config.show_traffic ? `<div class="fact net-fact"><span>网络</span><strong class="net-down">↓ ${speed(n.metrics?.net_rx)}</strong><strong class="net-up">↑ ${speed(n.metrics?.net_tx)}</strong></div>` : ""}</div>
      <div class="node-footer"><span>${valid(n.cpu_cores) ? `${n.cpu_cores} vCPU` : "vCPU 未提供"} · ${html(n.os || "系统未提供")}</span><span class="${expires !== null && expires <= 3 ? "expiry-warning" : ""}">${expires === null ? "无到期限制" : expires < 0 ? `已过期 ${Math.abs(expires)} 天` : expires === 0 ? "今天到期" : `${expires} 天后到期`}</span></div>
    </div>`
    }</article>`;
}
function detailField(label: string, value: unknown) {
  return `<div><dt>${html(label)}</dt><dd>${html(value)}</dd></div>`;
}
function trafficBlock(n: NodeInfo): string {
  const limit = valid(n.traffic_limit) ? n.traffic_limit : null;
  const used = valid(n.month_used) ? n.month_used : null;
  const rx = n.total_rx ?? n.metrics?.total_rx;
  const tx = n.total_tx ?? n.metrics?.total_tx;
  const total = valid(rx) && valid(tx) ? rx + tx : null;
  const remaining =
    limit === 0
      ? "不限量"
      : limit === null || used === null
        ? "N/A"
        : bytes(Math.max(0, limit - used));
  return `<div class="traffic-block"><div><span>周期额度</span><strong>${limit === 0 ? "不限量" : bytes(limit)}</strong></div><div><span>本期已用</span><strong>${bytes(used)}</strong></div><div><span>剩余流量</span><strong class="${limit && used !== null && used >= limit ? "expiry-warning" : "traffic-remaining"}">${remaining}</strong></div><div><span>累计总流量</span><strong>${bytes(total)}</strong></div></div>`;
}
function trafficMeter(n: NodeInfo): string {
  const limit = valid(n.traffic_limit) ? n.traffic_limit : null;
  const used = valid(n.month_used) ? n.month_used : null;
  const percentage =
    limit && used !== null ? Math.min(100, (used / limit) * 100) : null;
  const value =
    limit === 0
      ? "不限量"
      : limit === null || used === null
        ? "N/A"
        : `${bytes(Math.max(0, limit - used))} / ${bytes(limit)}`;
  return `<div class="meter-row traffic-meter" title="本期已用 ${bytes(used)}；剩余 / 周期额度 ${value}"><span class="meter-label">流量</span><span class="meter-number">${fmtPercent(percentage)}</span><div class="meter-wrap"><span class="meter-fill ${percentage !== null && percentage > 90 ? "meter-danger" : ""}" style="width:${percentage ?? 0}%"></span><span class="traffic-value">${html(value)}</span></div></div>`;
}
function probePanel(n: NodeInfo): string {
  const cached = cachedHistory(n.id);
  const data = isDemo
    ? (n as NodeInfo & { _demoProbes?: PingHistory })._demoProbes
    : cached?.probes;
  if (!isDemo && !cached?.probes && !cached?.pingError)
    return '<div class="detail-muted">正在加载三网探测……</div>';
  if (cached?.pingError)
    return `<div class="history-error" role="status">${html(cached.pingError)} <button class="classic-button" data-action="refresh">重试探测</button></div>`;
  const ids = [...new Set(data?.ping.map((p) => p.task_id) ?? [])];
  const names = ids.map(
    (id) => data?.probes[String(id)] ?? `探测 ${id ?? "未命名"}`,
  );
  const missing = ["电信", "联通", "移动"].filter(
    (carrier) => !names.some((name) => name.includes(carrier)),
  );
  const colors = ["#78d998", "#70baff", "#f0bd65", "#d3a8ff"];
  const allPoints = data?.ping ?? [];
  const peak =
    Math.ceil(
      Math.max(1, ...allPoints.map((p) => (valid(p.latency) ? p.latency : 0))) /
        10,
    ) * 10;
  const domain: [number, number] = [
    Math.min(...allPoints.map((p) => p.ts)),
    Math.max(...allPoints.map((p) => p.ts)),
  ];
  const lines: string[] = [];
  const panels = ids.map((id, i) => {
    const points = data!.ping
      .filter((p) => p.task_id === id)
      .sort((a, b) => a.ts - b.ts);
    const latest = points.at(-1)?.latency;
    const loss = data!.loss?.[String(id)];
    const lossText =
      valid(loss) && loss <= 100
        ? `${loss.toFixed(1)}%`
        : loss === undefined &&
            points.length &&
            points.every((p) => valid(p.latency))
          ? "0.0%"
          : "N/A";
    const plot = chartSvg(
      points.map((p) => p.latency),
      "三网延迟（ms）",
      720,
      180,
      {
        hours: historyHours,
        timestamps: points.map((p) => p.ts),
        step: data!.step,
        domain,
        maxValue: peak,
        unit: " ms",
      },
    );
    lines.push(
      `<g class="probe-series" style="stroke:${colors[i % colors.length]}">${plot.match(/<g class="graph-line">([\s\S]*?)<\/g>/)?.[1] ?? ""}</g>`,
    );
    return `<div class="probe-card"><div class="probe-heading"><strong><i style="background:${colors[i % colors.length]}"></i>${html(names[i])}</strong><span>${valid(latest) ? `${latest.toFixed(1)} ms` : "超时 / 无响应"}</span></div><p>查询范围丢包率 <strong>${lossText}</strong></p></div>`;
  });
  const plot = allPoints.length
    ? chartSvg(
        allPoints.some((p) => valid(p.latency)) ? [0] : [null],
        "三网延迟（ms）",
        720,
        180,
        { hours: historyHours, maxValue: peak, unit: " ms", domain },
      )
        .replace(
          /<g class="graph-line">[\s\S]*?<\/g>/,
          `<g class="graph-line">${lines.join("")}</g>`,
        )
        .replace(
          /<div class="graph-caption">[\s\S]*?<\/div>/,
          '<div class="graph-caption"><span>三网延迟（ms）</span><span>同一时间轴 · 同一刻度</span></div>',
        )
    : "";
  return `<div class="probe-grid"><div class="probe-legend">${panels.join("")}${missing.map((name) => `<div class="probe-card probe-unconfigured"><strong>${name}</strong><p>未配置探测</p></div>`).join("")}</div>${plot}</div><p class="detail-muted">探测为节点到运营商目标的 TCP 握手延迟；监控名称与结果由 Hub 提供。</p>`;
}
function detailPanel(title: string, content: string) {
  return `<fieldset class="win-panel"><legend>${html(title)}</legend>${content}</fieldset>`;
}
function rangeLabel(hours: number) {
  return hours >= 24 ? `${hours / 24} 天` : `${hours} 小时`;
}
function historyWindows() {
  const days = valid(me.history_days)
    ? Math.min(365, Math.max(1, Math.floor(me.history_days)))
    : 7;
  const whole = days * 24;
  return [
    ...[1, 6, 24, 168, 720, 2160].filter((h) => h * 1.25 <= whole),
    whole,
  ];
}
function detailGraph(label: string, points: Array<number | null>) {
  const cached = cachedHistory(detailId() ?? 0);
  if (!isDemo && !cached?.raw && !cached?.error)
    return '<div class="detail-muted">正在获取历史数据……</div>';
  if (!isDemo && cached?.error)
    return `<div class="history-error" role="status">${html(cached.error)} <button class="classic-button" data-action="refresh">重试历史</button></div>`;
  const raw = cached?.raw;
  return `<div class="detail-graph">${chartSvg(points, label, 480, 150, { hours: historyHours, timestamps: raw?.metrics?.map((p) => p.ts), step: raw?.step })}</div>`;
}
function detailHistory(node: NodeInfo) {
  const cached = cachedHistory(node.id);
  if (isDemo)
    return detailGraph(
      "CPU 使用率",
      node.online &&
        nodeState(node) !== "pending" &&
        nodeState(node) !== "invalid"
        ? demoChart(node.id)
        : [],
    );
  if (!cached?.raw && !cached?.error)
    return '<div class="detail-muted">正在获取历史数据……</div>';
  if (cached.error)
    return `<div class="history-error" role="status">${html(cached.error)} <button class="classic-button" data-action="refresh">重试历史</button></div>`;
  return detailGraph("CPU 使用率", cached.data);
}
function renderNodePage(node: NodeInfo | undefined, id: number): string {
  if (!node)
    return `<main class="content node-page" id="main-content" tabindex="-1"><div class="detail-toolbar classic-title">节点详情</div><div class="detail-inner"><div class="empty-state"><p>${!nodes ? (error ? html(error) : "正在读取节点详情……") : `未找到编号为 ${id} 的节点`}</p><small>${!nodes ? "正在连接 Monitor Hub" : "节点可能已删除或无权查看"}</small><button class="classic-button" data-action="${!nodes && error ? "refresh" : "back"}">${!nodes && error ? "重试连接" : "← 返回节点列表"}</button></div></div></main>`;
  const m = node.metrics,
    st = nodeState(node),
    validMonth = valid(node.month_used) ? node.month_used : null;
  const sections = {
    overview: "概览",
    performance: "性能监视器",
    network: "网络流量",
    hardware: "硬件信息",
  } as const;
  const grouped = (...items: [string, unknown][]) =>
    `<dl class="properties">${items.map(([a, b]) => detailField(a, b)).join("")}</dl>`;
  const meterGrid = `<div class="detail-meter-grid">${[
    ["CPU 使用率", cpuValue(node)],
    ["内存使用率", ramValue(node)],
    ["硬盘使用率", diskValue(node)],
  ]
    .map(
      ([name, val]) =>
        `<div class="detail-meter">${meter(String(name), val as number | null)}</div>`,
    )
    .join("")}</div>`;
  let content = "";
  if (detailTab === "overview") {
    content = `<div class="detail-columns">${detailPanel("当前状态", `<div class="detail-banner"><span class="status-dot ${st}"></span><strong>${stateZh(st)}</strong> · ${html(locationName(node.country))}</div>${meterGrid}${detailHistory(node)}`)}
    ${detailPanel("节点摘要", grouped(["名称", node.name], ["节点编号", node.id], ["国家/地区", locationName(node.country)], ["分组", node.group || "未分组"], ["在线时间", duration(m?.uptime)], ["延迟", pingText(node)], ["最近上报", age(node)], ["备注", node.public_remark || "—"]))}</div>`;
  } else if (detailTab === "performance") {
    const c = cachedHistory(node.id);
    const memTotal = m?.mem_total ?? node.mem_total;
    const diskTotal = m?.disk_total ?? node.disk_total;
    const memData =
      c?.raw?.metrics?.map((pt) =>
        valid(pt.mem_used) && valid(memTotal) && memTotal > 0
          ? Math.min(100, (pt.mem_used! / memTotal) * 100)
          : null,
      ) ?? [];
    const diskData =
      c?.raw?.metrics?.map((pt) =>
        valid(pt.disk_used) && valid(diskTotal) && diskTotal > 0
          ? Math.min(100, (pt.disk_used! / diskTotal) * 100)
          : null,
      ) ?? [];
    content = `${detailPanel("实时资源", meterGrid)}<div class="detail-chart-grid performance-chart-grid">${detailPanel("CPU 历史", detailHistory(node))}${detailPanel("内存历史", detailGraph("内存使用率", isDemo ? demoChart(node.id + 3) : memData))}${detailPanel("硬盘历史", detailGraph("硬盘使用率", isDemo ? demoChart(node.id + 6) : diskData))}</div>`;
  } else if (detailTab === "network") {
    const c = cachedHistory(node.id),
      points = c?.raw?.metrics ?? [];
    const peaks = Math.max(
      1,
      ...points.flatMap((p) => [
        valid(p.net_rx) ? p.net_rx : 0,
        valid(p.net_tx) ? p.net_tx : 0,
      ]),
    );
    const series = (key: "net_rx" | "net_tx") =>
      isDemo
        ? demoChart(node.id + (key === "net_rx" ? 1 : 5))
        : points.map((p) =>
            valid(p[key]) ? Math.min(100, (p[key]! / peaks) * 100) : null,
          );
    content = `${detailPanel("三网线路 / 网络探测", probePanel(node))}${detailPanel("流量额度与用量", trafficBlock(node))}${detailPanel("实时网络", grouped(["下载速度", speed(m?.net_rx)], ["上传速度", speed(m?.net_tx)], ["延迟", pingText(node)], ["本月已用流量（Hub）", bytes(validMonth)], ["本月接收", bytes(node.month_rx ?? m?.month_rx)], ["本月发送", bytes(node.month_tx ?? m?.month_tx)], ["累计接收", bytes(node.total_rx ?? m?.total_rx)], ["累计发送", bytes(node.total_tx ?? m?.total_tx)], ["流量限制", node.traffic_limit ? bytes(node.traffic_limit) : "未设置"]))}
      <div class="detail-chart-grid">${detailPanel("下载趋势", detailGraph("下载速率（相对峰值）", series("net_rx")))}${detailPanel("上传趋势", detailGraph("上传速率（相对峰值）", series("net_tx")))}</div><p class="detail-muted">趋势图纵轴按当前查询范围内的峰值归一化；实时速率与累计流量以 Hub 数据为准。</p>`;
  } else {
    content = `${detailPanel("系统和硬件", grouped(["操作系统", node.os || "未提供"], ["主机名", node.hostname || "未提供"], ["内核", node.kernel || "未提供"], ["系统架构", node.arch || "未提供"], ["虚拟化", node.virt || "未提供"], ["CPU 型号", node.cpu_name || "未提供"], ["CPU 核心", node.cpu_cores ?? "未提供"], ["内存总量", bytes(m?.mem_total ?? node.mem_total)], ["硬盘总量", bytes(m?.disk_total ?? node.disk_total)], ["网络地址", node.ip || "未公开"], ["到期剩余天数", expDays(node) === null ? "未设置" : `${expDays(node)} 天`], ["公开备注", node.public_remark || "—"]))}`;
  }
  return `<main class="content node-page" id="main-content" tabindex="-1"><div class="detail-toolbar classic-title">${navigationToggle()}${flagImage(node.country, "title-flag")}<span>${html(node.name)} · 属性</span><button class="title-btn" data-action="back" title="返回节点列表" aria-label="返回节点列表">×</button></div>
    <div class="detail-inner"><div class="detail-navigation"><button class="classic-button" data-action="back">← 返回节点列表</button><span>节点属性 / ${html(node.name)}</span></div>
    <div class="detail-header">${flagImage(node.country, "detail-flag")}<div><h1>${html(node.name)}</h1><p><span class="status-dot ${st}"></span> ${stateZh(st)} · ${html(locationName(node.country))} · #${node.id}</p></div></div>
    ${error ? `<div class="error-banner" role="alert">${html(error)} <button data-action="refresh">重试</button></div>` : ""}
    <div class="history-controls"><span>历史范围</span><select id="history-range" aria-label="历史范围">${historyWindows()
      .map(
        (h) =>
          `<option value="${h}" ${historyHours === h ? "selected" : ""}>${rangeLabel(h)}</option>`,
      )
      .join(
        "",
      )}</select><span class="retention-label">保留 ${Math.max(...historyWindows()) / 24} 天</span><button class="classic-button" data-action="refresh">↻ 刷新</button></div>
    <nav class="detail-tabs" aria-label="节点详情分类">${(Object.entries(sections) as [typeof detailTab, string][]).map(([key, val]) => `<button class="detail-tab ${detailTab === key ? "active" : ""}" data-tab="${key}" aria-current="${detailTab === key ? "page" : "false"}">${val}</button>`).join("")}</nav>
    <div class="detail-sections">${content}</div><div class="detail-footer"><button class="classic-button" data-action="refresh">刷新数据</button><button class="classic-button" data-action="back">关闭</button></div></div></main>`;
}
function renderMain() {
  const id = detailId();
  if (id !== null)
    return renderNodePage(
      nodes?.find((n) => n.id === id),
      id,
    );
  const result = visible(),
    a = nodes || [];
  return `<main class="content" id="main-content" tabindex="-1"><div class="content-toolbar classic-title"><div class="toolbar-name">${navigationToggle()} <span>${html(scopeText())}（${result.length} 台）</span></div>
    <div class="toolbar-right"><label class="toolbar-search" title="搜索节点"><span aria-hidden="true">⌕</span><input id="search-box" aria-label="搜索节点" placeholder="搜索名称、地区、分组" value="${html(search)}" /></label><label class="view-label" for="view-select">视图</label><select id="view-select" aria-label="卡片视图"><option value="cards" ${view === "cards" ? "selected" : ""}>卡片视图</option><option value="compact" ${view === "compact" ? "selected" : ""}>紧凑卡片</option></select>
    </div></div>
    ${isDemo ? '<div class="demo-banner" role="note"><strong>演示环境</strong><span>当前页面使用示例数据</span><a href="/">查看实时站点 ↗</a></div>' : ""}
    ${config.notice ? `<div class="notice" role="note"><strong>站点公告</strong> ${html(config.notice)}</div>` : ""}
    ${error ? `<div class="error-banner" role="alert">${html(error)} <button data-action="refresh">重试</button></div>` : ""}
    ${nodes ? renderOverview(result) : ""}
    ${hidden.size ? `<div class="restore-row">已隐藏 ${hidden.size} 张卡片 <button data-action="restore-all">恢复全部</button></div>` : ""}
    ${
      !nodes
        ? error
          ? `<div class="empty-state"><span class="empty-symbol">!</span><p>暂时无法连接站点</p><small>请重试连接；已有连接时会自动恢复</small><button class="classic-button" data-action="refresh">重新连接</button></div>`
          : `<div class="skeleton-grid" aria-label="正在加载节点">${Array.from({ length: 6 }, () => '<div class="skeleton-card"><div></div><span></span><span></span><span></span></div>').join("")}</div>`
        : !result.length
          ? `<div class="empty-state">${buttonIcon("folder")}<p>${a.length ? "没有匹配的节点" : "暂无节点"}</p><small>可以尝试切换分组、清空搜索，或恢复隐藏的卡片。</small><button class="classic-button" data-action="reset">显示全部节点</button></div>`
          : `<div data-key="node-grid" class="node-grid ${view === "compact" ? "compact-grid" : ""}" style="--cols:${config.columns}">${result.map((n) => `<div class="node-slot" data-key="node-slot-${n.id}">${nodeCard(n)}</div>`).join("")}</div>`
    }
  </main>`;
}
function renderOverview(list: NodeInfo[]) {
  const online = list.filter((n) => n.online).length;
  const alerts = list.filter((n) =>
    ["offline", "warning", "invalid"].includes(nodeState(n)),
  ).length;
  const rx = list
    .filter((n) => n.online && valid(n.metrics?.net_rx))
    .map((n) => n.metrics!.net_rx!);
  const tx = list
    .filter((n) => n.online && valid(n.metrics?.net_tx))
    .map((n) => n.metrics!.net_tx!);
  const sum = (values: number[]) =>
    values.length ? values.reduce((a, b) => a + b, 0) : list.length ? null : 0;
  return `<section class="overview-strip" aria-label="当前范围汇总"><div><span>当前节点</span><strong data-summary="total">${list.length}</strong><small>${html(scopeText())}</small></div><div><span>在线节点</span><strong class="summary-online">${online}<i> / ${list.length}</i></strong><small>${list.length ? Math.round((online / list.length) * 100) : 0}% 在线</small></div><div><span>需要关注</span><strong class="${alerts ? "summary-warning" : ""}">${alerts}</strong><small>离线 · 告警 · 异常</small></div>${config.show_traffic ? `<div><span>↓ 下载合计</span><strong class="summary-rate">${speed(sum(rx))}</strong><small>有效速率 ${rx.length} / ${list.length}</small></div><div><span>↑ 上传合计</span><strong class="summary-rate">${speed(sum(tx))}</strong><small>有效速率 ${tx.length} / ${list.length}</small></div>` : ""}</section>`;
}
function renderStatus() {
  const n = counts();
  return `<footer class="statusbar"><span class="status-cell status-ready">${isDemo ? "演示模式" : connection === "Live" ? "实时连接" : connection === "Polling" ? "轮询中" : connection === "Offline" ? "连接中断" : connection === "Reconnecting" ? "重新连接中" : connection} · v${buildVersion}</span><span class="status-cell spacer"></span><span class="status-cell">节点总数：${n.all}</span><span class="status-cell">在线：${n.online}</span><span class="status-cell">离线：${n.offline}</span><span class="status-cell">告警：${n.warning}</span><span class="status-cell status-refresh"><span class="status-dot ${connection === "Live" || isDemo ? "online" : "offline"}"></span> 最近刷新：${refreshed ? new Date(refreshed).toLocaleTimeString("zh-CN") : "—"}</span></footer>`;
}
function renderModal() {
  if (!modal) return "";
  let title = "",
    content = "";
  if (modal.type === "network") {
    title = "网络概览";
    const list = nodes || [];
    content = `<p>按 Monitor Hub 提供的国家或地区信息汇总</p><div class="modal-list">${
      countries(list)
        .map(
          (c) =>
            `<div>${flagImage(c, "tree-flag")} <strong>${html(locationName(c))}</strong><span>在线 ${list.filter((n) => n.country === c && n.online).length} / 总计 ${list.filter((n) => n.country === c).length}</span></div>`,
        )
        .join("") || "暂无地区数据"
    }</div>`;
  } else if (modal.type === "performance") {
    title = "性能概览";
    const list = (nodes || []).filter((n) => n.online && cpuValue(n) !== null),
      total = list.length;
    const avg = total
      ? list.reduce((sum, n) => sum + (cpuValue(n) || 0), 0) / total
      : null;
    content = `<p>实时性能汇总（仅统计具有有效指标的在线节点）</p><dl class="properties">${detailField("可用节点", total)}${detailField("平均 CPU 使用率", fmtPercent(avg))}${detailField("总下载速度", speed(list.reduce((sum, n) => sum + (n.metrics?.net_rx || 0), 0)))}${detailField("总上传速度", speed(list.reduce((sum, n) => sum + (n.metrics?.net_tx || 0), 0)))}</dl>`;
  } else if (modal.type === "alerts") {
    title = "告警状态";
    const alert = (nodes || []).filter((n) =>
      ["warning", "offline", "invalid"].includes(nodeState(n)),
    );
    content = `<p>当前离线、高负载（大于 90%）以及三天内到期的节点</p><div class="modal-list">${alert.map((n) => `<div><span class="status-dot ${nodeState(n)}"></span> ${html(n.name)}<span>${stateZh(nodeState(n))}</span></div>`).join("") || "<p>当前没有告警或离线节点。</p>"}</div>`;
  } else if (modal.type === "settings") {
    title = "显示设置";
    content = `<p>调整这台设备的显示偏好。站点设置可在 Hub 主题管理中修改。</p><div class="setting-row"><label><input id="pref-sidebar" type="checkbox" ${(preferredSidebar ?? config.show_sidebar) ? "checked" : ""} /> 显示导航树</label></div><div class="setting-row"><label><input id="pref-compact" type="checkbox" ${view === "compact" ? "checked" : ""} /> 紧凑卡片视图</label></div><button class="classic-button" data-action="reset-preferences">恢复默认显示</button><button class="classic-button" data-action="open-admin">打开管理后台 ↗</button>`;
  }
  return `<div class="modal-backdrop" data-action="close-modal"><section class="dialog-window" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabindex="-1"><div class="classic-title dialog-title"><span id="modal-title">${html(title)}</span><button class="title-btn" data-action="close-modal" aria-label="关闭弹窗">×</button></div><div class="dialog-body">${content}<div class="dialog-footer"><button class="classic-button" data-action="close-modal">确定</button></div></div></section></div>`;
}
let pendingRender: number | undefined;
function scheduleRender() {
  if (pendingRender === undefined)
    pendingRender = requestAnimationFrame(() => render());
}
function render() {
  if (pendingRender !== undefined) cancelAnimationFrame(pendingRender);
  pendingRender = undefined;
  existingCharts = new Set(
    Array.from(root.querySelectorAll<HTMLElement>("[data-static-key]")).map(
      (el) => el.dataset.staticKey!,
    ),
  );
  // Re-rendering on each realtime frame must preserve the search caret and tree scroll position.
  const active = document.activeElement as HTMLInputElement | null;
  const keepSearch = active?.id === "search-box";
  const selStart = keepSearch ? active!.selectionStart : null;
  const selEnd = keepSearch ? active!.selectionEnd : null;
  const inDialog = !!active?.closest(".dialog-window");
  const focusSelector = active?.id
    ? `#${CSS.escape(active.id)}`
    : active?.dataset.action
      ? `[data-action="${CSS.escape(active.dataset.action)}"]${active.dataset.id ? `[data-id="${CSS.escape(active.dataset.id)}"]` : ""}`
      : active?.dataset.modal
        ? `[data-modal="${CSS.escape(active.dataset.modal)}"]`
        : active?.dataset.tab
          ? `[data-tab="${CSS.escape(active.dataset.tab)}"]`
          : active?.dataset.node
            ? `[data-node="${active.dataset.node}"]`
            : active?.dataset.scope
              ? `[data-scope="${CSS.escape(active.dataset.scope)}"]`
              : null;
  const treeTop = root.querySelector(".tree-scroll")?.scrollTop || 0;
  const routeKey = detailId() === null ? "list" : `node:${detailId()}`;
  if (previousRoute === "list" && routeKey !== "list")
    listScroll = root.querySelector(".content")?.scrollTop || 0;
  const bodyTop =
    routeKey === previousRoute
      ? root.querySelector(".content")?.scrollTop || 0
      : routeKey === "list"
        ? listScroll
        : 0;
  previousRoute = routeKey;
  updateMarkup(
    root,
    `<div class="desktop-shell ${!(preferredSidebar ?? config.show_sidebar) || !sidebarOpen ? "navigation-off" : ""}" ${modal ? "inert" : ""}><header class="desktop-heading"><div class="desktop-brand"><img src="/favicon.svg" alt="" /><div><span class="brand-kicker">MONITOR CLASSIC / SYSTEM CONSOLE</span><h1>${html(config.site_label || me.site_name || "节点管理器")}</h1></div></div><div class="desktop-actions"><span class="session-label"><span class="status-dot ${isDemo || connection === "Live" ? "online" : "offline"}"></span>${isDemo ? "演示环境" : connection === "Live" ? "实时监控" : "正在同步"}</span><button class="classic-button" data-action="refresh">↻ 刷新</button><a class="classic-button admin-link" href="/admin">管理后台 ↗</a></div></header><div class="workarea">
   ${renderSidebar()}<div class="main-column" data-key="main-column">${renderMain()}</div></div>${renderStatus()}</div>${renderModal()}`,
  );
  const tree = root.querySelector(".tree-scroll");
  if (tree && tree.scrollTop !== treeTop) tree.scrollTop = treeTop;
  const main = root.querySelector(".content");
  if (main && main.scrollTop !== bodyTop) main.scrollTop = bodyTop;
  if (focusSelector && !active?.isConnected) {
    const container =
      inDialog && modal ? root.querySelector(".dialog-window") : root;
    const element = container?.querySelector<HTMLElement>(focusSelector);
    if (element) element.focus({ preventScroll: true });
  }
  if (keepSearch) {
    const input = root.querySelector("#search-box") as HTMLInputElement | null;
    if (input) {
      try {
        input.setSelectionRange(selStart, selEnd);
      } catch {}
    }
  }
  if (modal && !inDialog)
    (
      root.querySelector(
        '.dialog-window [data-action="close-modal"]',
      ) as HTMLElement | null
    )?.focus();
}
function historyJobs() {
  const detail = detailId();
  const list =
    detail !== null
      ? (nodes ?? []).filter((n) => n.id === detail)
      : config.show_chart
        ? visible()
        : [];
  const viewport = new Set<number>();
  const main = root.querySelector(".content");
  if (detail === null && main) {
    const bounds = main.getBoundingClientRect();
    for (const card of main.querySelectorAll<HTMLElement>(".node-window")) {
      const rect = card.getBoundingClientRect();
      if (rect.bottom > bounds.top && rect.top < bounds.bottom)
        viewport.add(Number(card.dataset.node));
    }
  }
  // The first snapshot may precede DOM creation; prioritize its first row.
  if (!viewport.size) for (const n of list.slice(0, 3)) viewport.add(n.id);
  const jobs: Array<{
    id: number;
    series: "metrics" | "ping";
    priority: number;
  }> = [];
  for (const n of list) {
    const cached = cachedHistory(n.id);
    for (const series of ["metrics", "ping"] as const) {
      const key = `${historyKey(n.id)}:${series}`;
      const time = series === "metrics" ? cached?.time : cached?.pingTime;
      const failed = series === "metrics" ? cached?.error : cached?.pingError;
      if (
        !inFlight.has(key) &&
        (!time || Date.now() - time >= (failed ? 30_000 : 60_000))
      )
        jobs.push({
          id: n.id,
          series,
          priority: (viewport.has(n.id) ? 0 : 2) + (series === "ping" ? 1 : 0),
        });
    }
  }
  return jobs.sort((a, b) => a.priority - b.priority);
}
async function loadVisibleHistories() {
  if (isDemo || !nodes || document.hidden) return;
  if (inFlight.size >= historyRequestLimit) return;
  const jobs = historyJobs();
  const pendingMetrics = jobs.some((job) => job.series === "metrics");
  const pendingPing = jobs.some((job) => job.series === "ping");
  for (const { id, series } of jobs) {
    if (inFlight.size >= historyRequestLimit) return;
    const activeSeries = Array.from(inFlight).filter((key) =>
      key.endsWith(`:${series}`),
    ).length;
    // A slow probe must not occupy every slot while resource charts are queued,
    // and slow resource queries must leave a slot for latency.
    if (series === "ping" && pendingMetrics && activeSeries >= 1) continue;
    if (series === "metrics" && pendingPing && activeSeries >= 3) continue;
    const key = historyKey(id),
      requestKey = `${key}:${series}`;
    const epoch = historyEpoch,
      hours = historyHours;
    inFlight.add(requestKey);
    void (async () => {
      try {
        if (series === "metrics") {
          const raw = await getHistory(id, hours);
          if (epoch === historyEpoch && !document.hidden)
            history.set(key, {
              ...history.get(key),
              data: chartFromHistory(raw.metrics),
              ping: history.get(key)?.ping ?? null,
              raw,
              error: undefined,
              time: Date.now(),
            });
        } else {
          const probes = await getPing(id, hours);
          const latestTs = Math.max(...probes.ping.map((p) => p.ts));
          const ping =
            probes.ping
              .filter((p) => p.ts === latestTs)
              .find((p) => valid(p.latency))?.latency ?? null;
          if (epoch === historyEpoch && !document.hidden)
            history.set(key, {
              data: [],
              time: 0,
              ...history.get(key),
              ping,
              probes,
              pingError: undefined,
              pingTime: Date.now(),
            });
        }
      } catch (error) {
        if (epoch === historyEpoch && !document.hidden) {
          const cached = { data: [], ping: null, time: 0, ...history.get(key) };
          history.set(
            key,
            series === "metrics"
              ? { ...cached, error: (error as Error).message, time: Date.now() }
              : {
                  ...cached,
                  ping: null,
                  pingError: (error as Error).message,
                  pingTime: Date.now(),
                },
          );
        }
      } finally {
        inFlight.delete(requestKey);
        if (epoch === historyEpoch && !document.hidden) scheduleRender();
        void loadVisibleHistories();
      }
    })();
  }
}
// Scroll events do not bubble; capture them and coalesce priority updates.
let historyScrollFrame: number | undefined;
root.addEventListener(
  "scroll",
  (event) => {
    if (
      !(event.target instanceof Element) ||
      !event.target.matches(".content") ||
      historyScrollFrame !== undefined
    )
      return;
    historyScrollFrame = requestAnimationFrame(() => {
      historyScrollFrame = undefined;
      void loadVisibleHistories();
    });
  },
  true,
);
root.addEventListener("input", (event) => {
  const t = event.target as HTMLInputElement;
  if (t.id === "search-box") {
    search = t.value;
    render();
    void loadVisibleHistories();
  }
});
root.addEventListener("change", (event) => {
  const t = event.target as HTMLInputElement;
  if (t.id === "view-select") {
    view = t.value === "compact" ? "compact" : "cards";
    savePreferences();
    render();
  }
  if (t.id === "pref-sidebar") {
    preferredSidebar = t.checked;
    savePreferences();
    render();
  }
  if (t.id === "pref-compact") {
    view = t.checked ? "compact" : "cards";
    savePreferences();
    render();
  }
  if (t.id === "history-range") {
    const hours = Number(t.value);
    if (historyWindows().includes(hours)) {
      historyHours = hours;
      historyEpoch++;
      history.clear();
      render();
      void loadVisibleHistories();
    }
  }
});
root.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const action = target.closest<HTMLElement>("[data-action]");
  const nav = target.closest<HTMLElement>("[data-scope]");
  const mod = target.closest<HTMLElement>("[data-modal]");
  if (nav) {
    scope = nav.dataset.scope || "all";
    if (window.innerWidth <= 700) sidebarOpen = false;
    render();
    void loadVisibleHistories();
    return;
  }
  if (mod) {
    modalOpener = `[data-modal="${mod.dataset.modal}"]`;
    modal = {
      type: mod.dataset.modal as
        "network" | "performance" | "alerts" | "settings",
    };
    render();
    return;
  }
  if (!action) {
    const tab = target.closest<HTMLElement>("[data-tab]");
    if (tab) {
      detailTab = (tab.dataset.tab || "overview") as typeof detailTab;
      render();
      return;
    }
    const card = target.closest<HTMLElement>("[data-node]");
    if (card) {
      openDetail(Number(card.dataset.node));
      void loadVisibleHistories();
    }
    return;
  }
  if (
    action.dataset.action === "close-modal" &&
    target.closest(".dialog-window") &&
    target !== action
  )
    return;
  const id = Number(action.dataset.id);
  switch (action.dataset.action) {
    case "min":
      minimized.has(id) ? minimized.delete(id) : minimized.add(id);
      break;
    case "hide":
      hidden.add(id);
      break;
    case "detail":
      openDetail(id);
      void loadVisibleHistories();
      return;
    case "back":
      closeDetail();
      return;
    case "tab":
      detailTab = action.dataset.tab as typeof detailTab;
      break;
    case "toggle-sidebar":
    case "collapse-sidebar":
      if (!(preferredSidebar ?? config.show_sidebar)) {
        preferredSidebar = true;
        sidebarOpen = true;
        savePreferences();
      } else sidebarOpen = !sidebarOpen;
      break;
    case "toggle-tree": {
      const tree = action.dataset.tree!;
      if (collapsedTrees.has(tree)) collapsedTrees.delete(tree);
      else collapsedTrees.add(tree);
      break;
    }
    case "refresh":
      historyEpoch++;
      for (const cached of history.values()) {
        cached.time = 0;
        cached.pingTime = 0;
      }
      client.refresh();
      void loadVisibleHistories();
      break;
    case "restore-all":
      hidden.clear();
      break;
    case "reset":
      scope = "all";
      search = "";
      hidden.clear();
      break;
    case "close-modal":
      closeModal();
      return;
    case "reset-preferences":
      view = "cards";
      preferredSidebar = undefined;
      savePreferences();
      break;
    case "open-admin":
      location.href = "/admin";
      return;
  }
  render();
});
function closeModal() {
  modal = null;
  render();
  (
    root.querySelector<HTMLElement>(modalOpener) ||
    root.querySelector<HTMLElement>(".desktop-actions button")
  )?.focus({ preventScroll: true });
}
document.addEventListener("keydown", (e) => {
  if (modal && e.key === "Tab") {
    const controls = [
      ...root.querySelectorAll<HTMLElement>(
        ".dialog-window button,.dialog-window input,.dialog-window a",
      ),
    ].filter((el) => el.getClientRects().length);
    const first = controls[0],
      last = controls.at(-1);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
    return;
  }
  if (e.key === "Escape") {
    if (modal) closeModal();
    else if (detailId() !== null) closeDetail();
    return;
  }
  if (e.key === "Enter" || e.key === " ") {
    const t = e.target as HTMLElement;
    if (t.matches(".node-window")) {
      e.preventDefault();
      openDetail(Number(t.dataset.node));
      void loadVisibleHistories();
    }
  }
});
window.addEventListener("hashchange", () => {
  render();
  focusRoute();
  void loadVisibleHistories();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) historyEpoch++;
  else void loadVisibleHistories();
});
async function boot() {
  render();
  if (isDemo) {
    client.start(true);
    client.setDemo(demo!);
  } else client.start();
  const [conf, profile] = await Promise.allSettled([
    isDemo ? Promise.resolve(defaults) : loadConfig(),
    isDemo
      ? Promise.resolve({ site_name: "DEMO WORKSTATION", history_days: 7 })
      : getMe(),
  ]);
  if (conf.status === "fulfilled") config = conf.value;
  if (profile.status === "fulfilled") me = profile.value;
  document.title = `${config.site_label || me.site_name || "节点管理器"} · Monitor Classic`;
  if (!historyWindows().includes(historyHours))
    historyHours = Math.min(24, Math.max(...historyWindows()));
  if (config.show_chart || detailId() !== null) void loadVisibleHistories();
  render();
  retryTimer = setInterval(() => {
    if (!document.hidden && !isDemo && nodes) void loadVisibleHistories();
  }, 60_000);
}
window.addEventListener("pagehide", () => {
  client.destroy();
  if (retryTimer) clearInterval(retryTimer);
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    client.start(isDemo);
    if (!isDemo)
      retryTimer = setInterval(() => {
        if (!document.hidden && nodes) void loadVisibleHistories();
      }, 60_000);
    void loadVisibleHistories();
  }
});
void boot();
