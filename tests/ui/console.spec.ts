import { test, expect } from "@playwright/test";
test("mobile header replaces refresh with the Hub administration link", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/demo.html");
  await expect(page.locator(".desktop-actions .admin-link")).toBeVisible();
  await expect(
    page.locator('.desktop-actions [data-action="refresh"]'),
  ).toBeHidden();
  await expect(page.locator(".desktop-actions .admin-link")).toHaveAttribute(
    "href",
    "/admin",
  );
  await page.route("**/admin", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<h1>Hub administration</h1>",
    }),
  );
  await page.locator(".desktop-actions .admin-link").click();
  await expect(
    page.getByRole("heading", { name: "Hub administration" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/demo.html");
  await expect(page.locator(".desktop-actions .admin-link")).toBeVisible();
  await expect(
    page.locator('.desktop-actions [data-action="refresh"]'),
  ).toBeVisible();
});
test("percentage typography leaves a clear gap before progress bars", async ({
  page,
}) => {
  for (const width of [320, 700, 1280, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/demo.html");
    await page.evaluate(() => document.fonts.ready);
    const gaps = await page
      .locator(".node-window .meter-row")
      .evaluateAll((rows) =>
        rows.map((row) => {
          const text = row.querySelector(".meter-number")!;
          text.textContent = "100.0%";
          const range = document.createRange();
          range.selectNodeContents(text);
          return (
            row.querySelector(".meter-wrap")!.getBoundingClientRect().left -
            range.getBoundingClientRect().right
          );
        }),
      );
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(2);
  }
});
test("hiding restoring and filtering cards keeps their reused historical charts", async ({
  page,
}) => {
  await page.goto("/demo.html");
  await expect(page.locator(".node-window .graph-svg")).toHaveCount(8);
  await page.locator('[data-action="hide"]').first().click();
  await expect(page.locator(".node-window .graph-svg")).toHaveCount(7);
  await page.locator('[data-action="restore-all"]').click();
  await expect(page.locator(".node-window .graph-svg")).toHaveCount(8);
  await page.locator("#search-box").fill("Tokyo");
  await expect(page.locator(".node-window .graph-svg")).toHaveCount(2);
  await page.locator("#search-box").fill("");
  await expect(page.locator(".node-window .graph-svg")).toHaveCount(8);
});
test("performance history uses three full-width rows", async ({ page }) => {
  await page.goto("/demo.html#/node/1");
  await page.getByRole("button", { name: "性能监视器", exact: true }).click();
  const panels = page.locator(".performance-chart-grid > fieldset");
  await expect(panels).toHaveCount(3);
  const boxes = await panels.evaluateAll((elements) =>
    elements.map((el) => {
      const { x, y, width, height } = el.getBoundingClientRect();
      return { x, y, width, height };
    }),
  );
  expect(boxes[1].y).toBeGreaterThanOrEqual(boxes[0].y + boxes[0].height);
  expect(boxes[2].y).toBeGreaterThanOrEqual(boxes[1].y + boxes[1].height);
  expect(boxes.map((box) => box.x)).toEqual([
    boxes[0].x,
    boxes[0].x,
    boxes[0].x,
  ]);
  expect(boxes.map((box) => box.width)).toEqual([
    boxes[0].width,
    boxes[0].width,
    boxes[0].width,
  ]);
});
test("left icon controls navigation and expanded folders can collapse independently", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/demo.html");
  await expect(page.locator(".view-square,.mobile-menu")).toHaveCount(0);
  await expect(page.locator(".desktop-brand #navigation-toggle")).toHaveCount(
    1,
  );
  await expect(
    page.locator(
      '.content-toolbar [data-action="toggle-sidebar"],.detail-toolbar [data-action="toggle-sidebar"]',
    ),
  ).toHaveCount(0);
  await expect(page.locator("#navigation-toggle")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  for (const id of ["nodes", "countries", "groups"]) {
    const heading = page.locator(`#tree-heading-${id}`);
    await expect(heading).toHaveAttribute("aria-expanded", "true");
    await heading.click();
    await expect(page.locator(`#tree-children-${id}`)).toBeHidden();
    await expect(heading).toBeFocused();
    await heading.press("Enter");
    await expect(page.locator(`#tree-children-${id}`)).toBeVisible();
  }
  const fontSize = await page
    .locator(".meter-label")
    .first()
    .evaluate((label) => {
      const card = label.closest(".node-window")! as HTMLElement;
      return (
        (parseFloat(getComputedStyle(label).fontSize) *
          card.getBoundingClientRect().width) /
        card.offsetWidth
      );
    });
  expect(fontSize).toBeGreaterThanOrEqual(12);
  await page.locator("#navigation-toggle").click();
  await expect(page.locator(".sidebar")).toBeHidden();
  await page.locator("#navigation-toggle").click();
  await expect(page.locator(".sidebar")).toBeVisible();
  await page.locator('.node-window [data-action="detail"]').first().click();
  await page.locator("#navigation-toggle").click();
  await expect(page.locator(".sidebar")).toBeHidden();
});
test("themed view menu supports touch keyboard dismissal and stored selection", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/demo.html");
  await page.locator("#view-select").click();
  await expect(page.getByRole("listbox", { name: "卡片视图" })).toBeVisible();
  await expect(page.getByRole("option")).toHaveCount(2);
  await expect(
    page.getByRole("option", { name: "卡片视图", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.locator("#view-select")).toContainText("紧凑卡片");
  await expect(page.locator("#view-select")).toBeFocused();
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await page.reload();
  await expect(page.locator("#view-select")).toContainText("紧凑卡片");
  await page.locator("#view-select").click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(page.locator("#view-select")).toBeFocused();
  await page.locator("#view-select").click();
  await page.locator(".desktop-heading h1").click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
  const paint = await page
    .locator('.window-actions [data-action="detail"]')
    .first()
    .evaluate((el) => ({
      height: el.getBoundingClientRect().height,
      inset: getComputedStyle(el, "::before").top,
    }));
  expect(paint.height).toBeGreaterThanOrEqual(28);
  expect(paint.inset).toBe("3px");
});
test("desktop displays three cards per row with the same proportions across widths", async ({
  page,
}) => {
  const ratios: number[] = [];
  for (const width of [960, 1280, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/demo.html");
    const cards = page.locator(".node-window");
    await expect(cards).toHaveCount(8);
    const boxes = await Promise.all(
      [0, 1, 2, 3].map((i) => cards.nth(i).boundingBox()),
    );
    expect(Math.abs(boxes[0]!.y - boxes[2]!.y)).toBeLessThan(2);
    expect(boxes[3]!.y).toBeGreaterThan(boxes[0]!.y + boxes[0]!.height);
    ratios.push(boxes[0]!.width / boxes[0]!.height);
  }
  expect(Math.max(...ratios) - Math.min(...ratios)).toBeLessThan(0.02);
});
test("cards show quota remaining and total traffic and detail shows three carriers", async ({
  page,
}) => {
  await page.goto("/demo.html");
  const traffic = page.locator(".traffic-meter").first();
  const bounds = await page.locator(".node-window").first().boundingBox();
  expect(bounds!.height).toBeLessThan(470);
  await expect(traffic).toContainText("流量");
  await expect(traffic).toContainText("887.0 GB");
  await expect(page.locator(".node-window .traffic-block")).toHaveCount(0);
  await page.locator('.node-window [data-action="detail"]').first().click();
  await page.locator('[data-tab="network"]').click();
  await expect(page.locator(".traffic-block")).toContainText("562.0 GB");
  await expect(page.locator(".probe-grid")).toContainText("上海电信");
  await expect(page.locator(".probe-grid")).toContainText("北京联通");
  await expect(page.locator(".probe-grid")).toContainText("广州移动");
  await expect(page.locator(".probe-grid")).toContainText("1.2%");
  await expect(page.locator(".probe-grid .graph-svg")).toHaveCount(1);
  await expect(page.locator(".probe-grid .probe-series")).toHaveCount(3);
});

test("console header, scoped summary and named cards form a clear hierarchy", async ({
  page,
}) => {
  await page.goto("/demo.html");
  await expect(page.locator(".node-window")).toHaveCount(8);
  await expect(page.locator(".desktop-heading")).toContainText("节点管理器");
  await expect(page.locator(".overview-strip")).toContainText("8");
  await expect(page.locator(".sidebar")).toBeVisible();
  await expect(page.locator(".node-window .node-body img")).toHaveCount(0);
  await expect(page.locator(".node-window .title-flag")).toHaveCount(8);
  await page.locator('[data-scope="group:生产环境"]').click();
  await expect(page.locator(".node-window")).toHaveCount(4);
  await expect(
    page.locator('.overview-strip [data-summary="total"]'),
  ).toHaveText("4");
});
test("mobile layout supports touch controls and long names without clipped content", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/demo.html?scenario=edge");
  await expect(page.locator(".node-window")).toHaveCount(8);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const card = page.locator(".node-window").first();
  const body = await card.boundingBox();
  expect(body!.width).toBeLessThan(360);
  const button = await card.locator('[data-action="detail"]').boundingBox();
  expect(button!.height).toBeGreaterThanOrEqual(28);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(page.locator(".node-window").nth(1)).toContainText("离线");
  await expect(page.locator(".node-window").nth(2)).toContainText("等待上报");
  await expect(page.locator(".node-window").nth(3)).toContainText("指标异常");
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  await card.press("Enter");
  await expect(page.locator(".node-page")).toBeVisible();
  await expect(page.locator("#history-range")).toBeVisible();
  const overflow = await page
    .locator(".detail-sections")
    .evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(overflow).toBe(false);
  expect(errors).toEqual([]);
});
test("dialog retains control focus and restores opener after close", async ({
  page,
}) => {
  await page.goto("/demo.html");
  await page.locator('[data-modal="settings"]').click();
  await page.locator("#pref-compact").check();
  await expect(page.locator("#pref-compact")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-modal="settings"]')).toBeFocused();
  await page.reload();
  await expect(page.locator("#view-select")).toContainText("紧凑卡片");
});

test("back from properties restores the list scroll position and focused card", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/demo.html");
  const card = page.locator('[data-node="7"]');
  await card.scrollIntoViewIfNeeded();
  await card.focus();
  const top = await page.locator(".content").evaluate((el) => el.scrollTop);
  await card.press("Enter");
  await expect(page.locator(".node-page")).toBeVisible();
  await page.locator('.detail-navigation [data-action="back"]').click();
  await expect(card).toBeFocused();
  expect(await page.locator(".content").evaluate((el) => el.scrollTop)).toBe(
    top,
  );
});

test("empty station and reduced motion keep a usable layout", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/demo.html?scenario=empty");
  await expect(page.locator(".empty-state")).toContainText("暂无节点");
  await expect(page.locator('[data-summary="total"]')).toHaveText("0");
});

for (const width of [320, 540, 700, 768, 960, 1280, 1440, 1920]) {
  test(`console and all properties tabs fit ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/demo.html?scenario=edge");
    await expect(page.locator(".node-window")).toHaveCount(8);
    expect(
      await page
        .locator(".content")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    await page.locator(".node-window").first().press("Enter");
    for (const tab of ["overview", "performance", "network", "hardware"]) {
      await page.locator(`[data-tab="${tab}"]`).click();
      expect(
        await page
          .locator(".detail-sections")
          .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      ).toBe(true);
    }
  });
}
