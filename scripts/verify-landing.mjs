import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const baseURL = process.env.STRUCTOR_PREVIEW_URL || "http://localhost:3000";
const output = await mkdtemp(join(tmpdir(), "structor-landing-"));
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const checks = [];
const check = (name) => {
  checks.push(name);
  console.log(`PASS ${name}`);
};

async function settled(target = page) {
  await target.locator(".landing-page").waitFor();
  await target.evaluate(() => document.fonts.ready);
  await target.waitForFunction(() => {
    const header = document.querySelector(".landing-header");
    if (!header) return false;
    const style = getComputedStyle(header);
    return style.opacity === "1" && style.transform === "none";
  });
}

async function screenshot(name, target = page) {
  await target.screenshot({
    path: join(output, `${name}.png`),
    animations: "disabled",
  });
}

async function assertNoOverflow(target = page) {
  const overflow = await target.evaluate(() => {
    const root = document.documentElement;
    const offenders = [...document.querySelectorAll("body *")]
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return (
          style.position !== "fixed" &&
          rect.width > 0 &&
          (rect.left < -1 || rect.right > innerWidth + 1)
        );
      })
      .slice(0, 8)
      .map((node) => ({
        className: node.className?.toString() || "",
        tag: node.tagName,
      }));
    return {
      clientWidth: root.clientWidth,
      offenders,
      scrollWidth: root.scrollWidth,
    };
  });
  assert.ok(
    overflow.scrollWidth <= overflow.clientWidth + 1,
    `Horizontal overflow: ${JSON.stringify(overflow)}`,
  );
}

async function assertOneLandingTypeface(target = page) {
  const typography = await target.evaluate(() => {
    const families = new Set();
    const italics = [];
    const walker = document.createTreeWalker(
      document.querySelector(".landing-page"),
      NodeFilter.SHOW_TEXT,
    );
    let textNode = walker.nextNode();
    while (textNode) {
      if (textNode.textContent?.trim()) {
        const element = textNode.parentElement;
        if (
          element &&
          !element.closest("code, pre") &&
          getComputedStyle(element).display !== "none" &&
          element.getClientRects().length
        ) {
          const style = getComputedStyle(element);
          families.add(style.fontFamily);
          if (style.fontStyle !== "normal") {
            italics.push({
              style: style.fontStyle,
              text: textNode.textContent.trim().slice(0, 60),
            });
          }
        }
      }
      textNode = walker.nextNode();
    }
    return { families: [...families], italics };
  });
  assert.equal(
    typography.families.length,
    1,
    `Expected one landing typeface, found ${typography.families.join(" | ")}`,
  );
  assert.deepEqual(typography.italics, []);
}

try {
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await settled();

  const header = page.locator(".landing-header");
  const nav = page.getByRole("navigation", {
    name: "Main navigation",
    exact: true,
  });
  const headerBox = await header.boundingBox();
  const navBox = await nav.boundingBox();
  assert.ok(headerBox && navBox);
  assert.equal(Math.round(headerBox.width), 1200);
  assert.equal(Math.round(headerBox.y), 24);
  assert.equal(Math.round(navBox.height), 52);
  assert.ok(
    Math.abs(
      navBox.x + navBox.width / 2 - (headerBox.x + headerBox.width / 2),
    ) <= 1,
    "Desktop navigation is not centered in the header",
  );

  const navLinks = nav.locator("a");
  const expectedNavigation = [
    ["Start", "#how-it-works"],
    ["Architecture", "#architecture"],
    ["Integrations", "#context"],
    ["FAQ", "#questions"],
  ];
  assert.deepEqual(
    (await navLinks.allTextContents()).map((label) => label.trim()),
    expectedNavigation.map(([label]) => label),
  );
  for (const [index, [, target]] of expectedNavigation.entries()) {
    const href = await navLinks.nth(index).getAttribute("href");
    assert.equal(href, target);
    assert.equal(await page.locator(target).count(), 1);
  }

  const homeDestinations = await page
    .locator(".landing-page a")
    .evaluateAll((links) => {
      const counts = new Map();
      for (const link of links) {
        const href = link.getAttribute("href");
        if (!href || (!href.startsWith("/") && !href.startsWith("#"))) {
          continue;
        }
        counts.set(href, (counts.get(href) ?? 0) + 1);
      }
      return [...counts.entries()].sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0,
      );
    });
  assert.deepEqual(homeDestinations, [
    ["#architecture", 1],
    ["#context", 1],
    ["#how-it-works", 1],
    ["#questions", 1],
    ["/", 2],
    ["/start", 2],
    ["/start?mode=repository", 1],
  ]);
  assert.equal(
    await page.locator('.landing-page a[href="/workspace"]').count(),
    0,
  );
  assert.equal(await page.locator(".landing-header-action").count(), 0);
  assert.equal(await page.locator(".final-cta").count(), 0);

  const colors = await page.evaluate(() => ({
    foreground: getComputedStyle(document.querySelector(".landing-hero")).color,
    header: getComputedStyle(document.querySelector(".landing-header-shell"))
      .backgroundColor,
    hero: getComputedStyle(document.querySelector(".landing-hero"))
      .backgroundColor,
  }));
  assert.deepEqual(colors, {
    foreground: "rgb(27, 32, 28)",
    header: "rgb(247, 247, 242)",
    hero: "rgb(247, 247, 242)",
  });
  assert.equal(
    await page.locator(".hero-footer").count(),
    0,
    "The removed decorative hero footer returned",
  );
  await assertOneLandingTypeface();
  await assertNoOverflow();
  await screenshot("desktop");
  check(
    "Neutral hero, centered navigation, one typeface, and exact home destinations",
  );

  const journey = await context.newPage();
  journey.on("pageerror", (error) => errors.push(error.message));
  try {
    await journey.goto(baseURL, { waitUntil: "networkidle" });
    await journey
      .locator(".landing-hero")
      .getByRole("link", { name: "Start a project", exact: true })
      .click();
    await journey.waitForURL(
      (url) => url.pathname === "/start" && url.search === "",
    );
    await journey.getByLabel("Project description", { exact: true }).waitFor();

    await journey.goto(baseURL, { waitUntil: "networkidle" });
    await journey.locator('.entry-card[href="/start"]').click();
    await journey.waitForURL(
      (url) => url.pathname === "/start" && url.search === "",
    );
    await journey.getByLabel("Project description", { exact: true }).waitFor();

    await journey.goto(baseURL, { waitUntil: "networkidle" });
    await journey.locator('.entry-card[href="/start?mode=repository"]').click();
    await journey.waitForURL(
      (url) => url.pathname === "/start" && url.search === "?mode=repository",
    );
    await journey
      .getByRole("heading", { name: "Import repository", exact: true })
      .waitFor();
    await journey
      .getByLabel("Choose repository ZIP", { exact: true })
      .waitFor();
  } finally {
    await journey.close();
  }
  check("Retained home calls to action open the intended start modes");

  const start = nav.getByRole("link", { name: "Start", exact: true });
  await start.hover();
  await page.waitForFunction(() => {
    const item = document
      .querySelector(".landing-desktop-nav a:hover")
      ?.closest(".landing-nav-item");
    return Boolean(item?.querySelector(".landing-nav-indicator"));
  });
  assert.equal(
    await start
      .locator("xpath=..")
      .locator(".landing-nav-indicator")
      .evaluate((node) => getComputedStyle(node).backgroundColor),
    "rgb(233, 236, 231)",
  );
  assert.equal(await nav.locator(".landing-nav-indicator").count(), 1);

  for (const [label, target] of expectedNavigation) {
    await nav.getByRole("link", { name: label, exact: true }).click();
    await page.waitForURL((url) => url.hash === target);
  }

  const architecture = nav.getByRole("link", {
    name: "Architecture",
    exact: true,
  });
  await architecture.click();
  await page.waitForURL(/#architecture$/);
  await page.waitForFunction(() =>
    Boolean(
      document.querySelector(
        '.landing-desktop-nav a[href="#architecture"][aria-current="location"]',
      ),
    ),
  );
  assert.equal(
    await architecture
      .locator("xpath=..")
      .locator(".landing-nav-indicator")
      .count(),
    1,
  );
  check("Navigation hover and active states share one animated pill");

  await page.locator(".landing-brand").click();
  await page.waitForURL((url) => url.hash === "");
  await page.waitForFunction(() => scrollY <= 8);
  await page.waitForFunction(
    () =>
      !document.querySelector(
        '.landing-desktop-nav .landing-nav-indicator, .landing-desktop-nav [aria-current="location"]',
      ),
  );
  assert.equal(await nav.locator(".landing-nav-indicator").count(), 0);
  assert.equal(await nav.locator('[aria-current="location"]').count(), 0);
  check("Returning home clears the active section highlight");

  await page.goto(baseURL, { waitUntil: "networkidle" });
  await settled();
  for (const width of [1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await assertNoOverflow();
    assert.equal(
      await page.locator(".landing-desktop-nav").isVisible(),
      width >= 1024,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Open menu", exact: true })
        .isVisible(),
      width < 1024,
    );
    await screenshot(`width-${width}`);
  }
  check("No horizontal overflow at 1024, 768, 390, or 320 pixels");

  await page.setViewportSize({ width: 390, height: 844 });
  const toggle = page.getByRole("button", { name: "Open menu", exact: true });
  await toggle.focus();
  await page.keyboard.press("Enter");
  const mobile = page.getByRole("navigation", {
    name: "Mobile navigation",
    exact: true,
  });
  await mobile.waitFor();
  assert.deepEqual(
    (await mobile.locator("a").allTextContents()).map((label) => label.trim()),
    ["Start", "Architecture", "Integrations", "FAQ"],
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Close menu", exact: true })
      .getAttribute("aria-expanded"),
    "true",
  );
  await assertNoOverflow();
  await screenshot("mobile-menu");
  await page.keyboard.press("Escape");
  await mobile.waitFor({ state: "hidden" });
  assert.equal(
    await toggle.evaluate((node) => document.activeElement === node),
    true,
  );
  await toggle.click();
  await page.mouse.click(8, 150);
  await mobile.waitFor({ state: "hidden" });
  for (const [label, target] of expectedNavigation) {
    await toggle.click();
    await mobile.waitFor();
    await mobile.getByRole("link", { name: label, exact: true }).click();
    await mobile.waitFor({ state: "hidden" });
    assert.equal(new URL(page.url()).hash, target);
  }
  check("Mobile menu supports keyboard, outside dismissal, and real anchors");

  await page.goto(baseURL, { waitUntil: "networkidle" });
  await settled();
  await page.getByRole("button", { name: "Open menu", exact: true }).click();
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.waitForFunction(
    () => !document.querySelector('[aria-label="Mobile navigation"]'),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open menu", exact: true }).waitFor();
  assert.equal(
    await page.getByRole("navigation", { name: "Mobile navigation" }).count(),
    0,
  );
  check("Mobile navigation resets after crossing the desktop breakpoint");

  const reducedContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  const reduced = await reducedContext.newPage();
  await reduced.goto(baseURL, { waitUntil: "networkidle" });
  await settled(reduced);
  const states = await reduced.locator(".landing-motion").evaluateAll((nodes) =>
    nodes.map((node) => ({
      opacity: getComputedStyle(node).opacity,
      transform: getComputedStyle(node).transform,
    })),
  );
  assert.ok(
    states.every(
      (state) => state.opacity === "1" && state.transform === "none",
    ),
  );
  const reducedPlane = reduced.locator(".integration-plane");
  const beforePointer = await reducedPlane.evaluate(
    (node) => getComputedStyle(node).transform,
  );
  const reducedScene = reduced.locator(".integration-scene");
  const sceneBox = await reducedScene.boundingBox();
  assert.ok(sceneBox);
  await reduced.mouse.move(sceneBox.x + 10, sceneBox.y + 10);
  await reduced.mouse.move(sceneBox.x + sceneBox.width - 10, sceneBox.y + 30);
  const afterPointer = await reducedPlane.evaluate(
    (node) => getComputedStyle(node).transform,
  );
  assert.equal(afterPointer, beforePointer);
  await reduced.locator(".entry-card").first().hover();
  assert.equal(
    await reduced
      .locator(".entry-card")
      .first()
      .evaluate((node) => getComputedStyle(node).transform),
    "none",
  );
  await screenshot("reduced-motion", reduced);
  await reducedContext.close();
  check(
    "Reduced motion removes entrances, hover lift, and pointer-driven tilt",
  );

  await page.setViewportSize({ width: 1440, height: 1000 });
  const cdp = await context.newCDPSession(page);
  await cdp.send("Animation.enable");
  await cdp.send("Animation.setPlaybackRate", { playbackRate: 0.1 });
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await page.waitForTimeout(6000);
  await page.screenshot({ path: join(output, "entrance-slow-motion.png") });
  await cdp.send("Animation.setPlaybackRate", { playbackRate: 1 });
  await settled();
  await assertNoOverflow();
  check("Header and centered nav reviewed at 10 percent animation speed");

  assert.deepEqual(errors, []);
  assert.equal(
    await page.evaluate(() => localStorage.length + sessionStorage.length),
    0,
  );
  check("No browser runtime errors or persistence writes");
  console.log(
    JSON.stringify({ checks: checks.length, screenshots: output }, null, 2),
  );
} catch (error) {
  await screenshot("failure");
  console.error("Screenshots:", output);
  throw error;
} finally {
  await browser.close();
}
