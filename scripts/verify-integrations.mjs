import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const baseURL = process.env.STRUCTOR_PREVIEW_URL || "http://localhost:3000";
const output = await mkdtemp(join(tmpdir(), "structor-integrations-"));
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
const requests = [];
let checks = 0;

const tools = [
  ["Claude Code", "claude-code", "code.claude.com"],
  ["Cursor", "cursor", "cursor.com"],
  ["Codex", "codex", "developers.openai.com"],
  ["GitHub Copilot", "copilot", "code.visualstudio.com"],
  ["Windsurf", "windsurf", "docs.windsurf.com"],
  ["Gemini CLI", "gemini", "geminicli.com"],
  ["Cline", "cline", "docs.cline.bot"],
  ["Continue", "continue", "docs.continue.dev"],
  ["Junie", "junie", "junie.jetbrains.com"],
];

function check(name) {
  checks++;
  console.log(`PASS ${name}`);
}

function track(target) {
  target.on("pageerror", (error) => errors.push(error.message));
  target.on("request", (request) => requests.push(request.url()));
}

const card = (name, target) =>
  target.getByRole("button", {
    name: `${name} MCP setup guide`,
    exact: true,
  });
const dialog = (target) => target.getByRole("dialog");
const artwork = (name, target) =>
  card(name, target).locator("..").locator(".integration-card-artwork");

async function capture(name, target) {
  await target.screenshot({
    path: join(output, `${name}.png`),
    animations: "disabled",
  });
}

async function settledDialog(target) {
  await dialog(target).waitFor();
  await target.waitForFunction(() => {
    const element = document.querySelector('[role="dialog"]');
    return (
      element &&
      getComputedStyle(element).opacity === "1" &&
      element
        .getAnimations()
        .every((animation) => animation.playState === "finished")
    );
  });
}

async function scrollToBoard(target) {
  await target.evaluate(() => {
    const section = document.querySelector("#context");
    window.scrollTo({ top: section.offsetTop, behavior: "instant" });
  });
}

async function clickRenderedCard(name, target) {
  const point = await pointerPointForCard(name, target);
  await target.mouse.click(point.x, point.y);
}

async function pointerPointForCard(name, target) {
  const point = await card(name, target).evaluate((button) => {
    const rect = button.getBoundingClientRect();
    const candidates = [];
    for (const yRatio of [0.5, 0.35, 0.65, 0.2, 0.8]) {
      for (const xRatio of [0.5, 0.35, 0.65, 0.2, 0.8]) {
        candidates.push({
          x: rect.left + rect.width * xRatio,
          y: rect.top + rect.height * yRatio,
        });
      }
    }
    return candidates.find(({ x, y }) =>
      document.elementsFromPoint(x, y).includes(button),
    );
  });
  assert.ok(point, `${name} has a pointer-reachable point`);
  return point;
}

async function verifyBounds(target, viewportWidth) {
  assert.equal(
    await target.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    "The page does not overflow horizontally",
  );

  const section = await target.locator("#context").boundingBox();
  const scene = await target.locator(".integration-scene").boundingBox();
  const planeLayout = await target.locator(".integration-plane").evaluate(
    (node) => ({ width: node.offsetWidth, height: node.offsetHeight }),
  );
  assert.ok(scene.height <= 500, `Compact scene height at ${viewportWidth}px`);
  assert.ok(
    planeLayout.width <= Math.min(460, viewportWidth - 32),
    `Compact plane width at ${viewportWidth}px`,
  );
  assert.ok(planeLayout.height <= 460, `Compact plane height at ${viewportWidth}px`);

  for (const button of await target.locator(".integration-card").all()) {
    const box = await button.boundingBox();
    assert.ok(box.width >= 44 && box.height >= 44, "Minimum 44px target size");
    assert.ok(
      box.x >= -1 && box.x + box.width <= viewportWidth + 1,
      "Card fits horizontally",
    );
    assert.ok(
      box.y >= section.y - 1 && box.y + box.height <= section.y + section.height + 1,
      "Card fits its section",
    );
  }
}

async function pose(target) {
  return target.locator(".integration-plane").evaluate((node) => {
    const transform = node.style.transform;
    const read = (axis) => {
      const match = transform.match(new RegExp(`rotate${axis}\\((-?[\\d.]+)deg\\)`));
      return match ? Number(match[1]) : Number.NaN;
    };
    return { x: read("X"), y: read("Y"), z: read("Z"), transform };
  });
}

const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
track(page);

try {
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await page.addStyleTag({
    content: "html, body { scroll-behavior: auto !important; }",
  });
  await page.evaluate(() => document.fonts.ready);
  await scrollToBoard(page);

  await page
    .getByRole("heading", {
      name: "Works with your favorite coding tool.",
      exact: true,
    })
    .waitFor();
  await page.getByText("Drag to rotate · select a tool", { exact: true }).waitFor();
  assert.equal(await page.getByText("Works with your stack.").count(), 0);
  assert.equal(await page.locator(".integration-card").count(), 9);
  assert.equal(await page.locator(".integration-card-depth").count(), 9);
  assert.equal(await page.locator(".integration-card-layer").count(), 0);
  assert.equal(await page.locator(".integration-foundation").count(), 0);

  for (const [name, id] of tools) {
    await card(name, page).waitFor();
    const asset = await context.request.get(`${baseURL}/integrations/${id}.svg`);
    assert.equal(asset.status(), 200);
    assert.match(await asset.text(), /<svg/);
    assert.ok(
      requests.some((url) => url.endsWith(`/integrations/${id}.svg`)),
      `${name} uses its local logo`,
    );
  }
  await verifyBounds(page, 1440);
  const sectionBox = await page.locator("#context").boundingBox();
  assert.ok(sectionBox.height <= 720, "Desktop integration section stays compact");
  await page.locator("#context").screenshot({
    path: join(output, "desktop-tool-board.png"),
    animations: "disabled",
  });
  check("Concise tool copy, nine local logos, nine depth slabs, and compact bounds");

  const hoverName = "Windsurf";
  const hoverArtwork = artwork(hoverName, page);
  const hoverCardFace = hoverArtwork.locator(".integration-card-face");
  const idleTransform = await hoverArtwork.evaluate(
    (node) => getComputedStyle(node).transform,
  );
  const idleFace = await hoverCardFace.evaluate(
    (node) => getComputedStyle(node).backgroundColor,
  );
  const hoverPoint = await pointerPointForCard(hoverName, page);
  await page.mouse.move(hoverPoint.x, hoverPoint.y);
  await page.waitForTimeout(190);
  const hoverTransform = await hoverArtwork.evaluate(
    (node) => getComputedStyle(node).transform,
  );
  const hoverFace = await hoverCardFace.evaluate(
    (node) => getComputedStyle(node).backgroundColor,
  );
  assert.notEqual(hoverTransform, idleTransform);
  assert.notEqual(hoverFace, idleFace);
  const transitionSeconds = await hoverArtwork.evaluate((node) =>
    getComputedStyle(node)
      .transitionDuration.split(",")
      .map((value) => Number.parseFloat(value)),
  );
  assert.ok(
    transitionSeconds.every((duration) => duration <= 0.2),
    "Hover transitions complete within 200ms",
  );
  await capture("hover-response-190ms", page);
  check("Card hover responds within 190ms with a short interruptible transition");

  const beforeDrag = await pose(page);
  assert.ok(
    [beforeDrag.x, beforeDrag.y, beforeDrag.z].every(Number.isFinite),
    "The spring exposes a three-axis pose",
  );
  const dragStart = await pointerPointForCard("Cursor", page);
  const startX = dragStart.x;
  const startY = dragStart.y;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 76, startY, { steps: 8 });
  await page.waitForTimeout(260);
  const afterHorizontal = await pose(page);
  assert.ok(
    Math.abs(afterHorizontal.y - beforeDrag.y) > 4,
    "Horizontal drag changes the Y-axis rotation",
  );
  await page.mouse.move(startX + 76, startY + 68, { steps: 8 });
  await page.waitForTimeout(260);
  const afterBothAxes = await pose(page);
  assert.ok(
    Math.abs(afterBothAxes.x - afterHorizontal.x) > 4,
    "Vertical drag changes the X-axis rotation",
  );
  assert.ok(
    Math.abs(afterBothAxes.z - beforeDrag.z) > 0.5,
    "Drag also produces restrained roll",
  );
  await capture("dragged-two-axis-pose", page);
  await page.mouse.up();
  await page.waitForTimeout(100);
  assert.equal(await dialog(page).isVisible(), false, "Dragging a card does not open it");

  await clickRenderedCard("Cursor", page);
  await settledDialog(page);
  await dialog(page)
    .getByRole("heading", { name: "Connect Structor to Cursor", exact: true })
    .waitFor();
  await capture("cursor-guide-after-drag", page);
  await page.keyboard.press("Escape");
  await dialog(page).waitFor({ state: "hidden" });
  check("Spring rotation follows both drag axes; drag suppresses click and a later click opens the guide");

  for (const [name, , host] of tools) {
    await card(name, page).focus();
    await page.keyboard.press("Enter");
    await settledDialog(page);
    const activeDialog = dialog(page);
    await activeDialog
      .getByRole("heading", {
        name: `Connect Structor to ${name}`,
        exact: true,
      })
      .waitFor();
    assert.ok(
      await activeDialog
        .getByText("Structor MCP is not live yet.", { exact: true })
        .isVisible(),
    );
    assert.match(
      await activeDialog.innerText(),
      /server URL and authentication method will be added when the service ships/i,
    );
    assert.equal(
      await activeDialog.locator(".integration-guide-steps > li").count(),
      3,
    );
    assert.equal(await activeDialog.locator("input, textarea").count(), 0);
    const docs = activeDialog.getByRole("link", { name: "Official MCP docs" });
    assert.equal(new URL(await docs.getAttribute("href")).hostname, host);
    assert.equal(await docs.getAttribute("target"), "_blank");
    await page.keyboard.press("Escape");
    await activeDialog.waitFor({ state: "hidden" });
    assert.ok(
      await card(name, page).evaluate((node) => node === document.activeElement),
    );
  }
  check("Every guide has a client-specific title, official docs, and honest not-live messaging");

  assert.equal(
    await page.locator("#context").getAttribute("aria-labelledby"),
    "integrations-heading",
  );
  assert.equal(
    await page.locator(".integration-scene").getAttribute("aria-describedby"),
    "integration-instructions",
  );
  assert.equal(
    await page.locator(".integration-grid").getAttribute("aria-label"),
    "Coding tools with MCP setup guides",
  );
  await card("Claude Code", page).focus();
  assert.equal(
    await card("Claude Code", page).evaluate(
      (node) => getComputedStyle(node).outlineStyle,
    ),
    "solid",
  );
  await page.keyboard.press("Space");
  await settledDialog(page);
  for (let index = 0; index < 6; index++) {
    await page.keyboard.press(index % 2 ? "Shift+Tab" : "Tab");
    assert.ok(
      await dialog(page).evaluate((node) => node.contains(document.activeElement)),
      "Dialog retains keyboard focus",
    );
  }
  await dialog(page).getByRole("button", { name: "Close setup guide" }).click();
  await dialog(page).waitFor({ state: "hidden" });
  check("Labeling, visible focus, Enter/Space, focus trap, Escape, and close control are accessible");

  await page.reload({ waitUntil: "networkidle" });
  await page.addStyleTag({
    content: "html, body { scroll-behavior: auto !important; }",
  });
  for (const [width, height] of [
    [1024, 1000],
    [768, 1000],
    [390, 844],
    [320, 640],
  ]) {
    await page.setViewportSize({ width, height });
    await scrollToBoard(page);
    await verifyBounds(page, width);
    if (width <= 390) {
      await page.locator("#context").screenshot({
        path: join(output, `tool-board-${width}.png`),
        animations: "disabled",
      });
    }
  }
  check("The compact board stays contained with 44px targets from 1024px through 320px");

  const touchContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const touch = await touchContext.newPage();
  track(touch);
  await touch.goto(baseURL, { waitUntil: "networkidle" });
  await touch.locator("#context").scrollIntoViewIfNeeded();
  for (const name of ["Claude Code", "GitHub Copilot", "Junie"]) {
    await card(name, touch).tap();
    await settledDialog(touch);
    await dialog(touch)
      .getByRole("heading", {
        name: `Connect Structor to ${name}`,
        exact: true,
      })
      .waitFor();
    const box = await dialog(touch).boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 390 && box.height <= 844);
    await dialog(touch).getByRole("button", { name: "Close setup guide" }).tap();
    await dialog(touch).waitFor({ state: "hidden" });
  }
  assert.equal(
    await touch.evaluate(() => localStorage.length + sessionStorage.length),
    0,
  );
  await touchContext.close();
  check("Touch taps open viewport-contained guides on mobile");

  const reducedContext = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    reducedMotion: "reduce",
  });
  const reduced = await reducedContext.newPage();
  track(reduced);
  await reduced.goto(baseURL, { waitUntil: "networkidle" });
  await scrollToBoard(reduced);
  const staticPose = await pose(reduced);
  const reducedScene = await reduced.locator(".integration-scene").boundingBox();
  await reduced.mouse.move(
    reducedScene.x + reducedScene.width * 0.82,
    reducedScene.y + reducedScene.height * 0.2,
  );
  await reduced.waitForTimeout(250);
  assert.deepEqual(await pose(reduced), staticPose);
  await card("Cursor", reduced).hover();
  assert.ok(
    await artwork("Cursor", reduced).evaluate(
      (node) => new DOMMatrix(getComputedStyle(node).transform).isIdentity,
    ),
  );
  await card("Cursor", reduced).click();
  await settledDialog(reduced);
  assert.ok(
    Number.parseFloat(
      await dialog(reduced).evaluate(
        (node) => getComputedStyle(node).animationDuration,
      ),
    ) < 0.001,
  );
  await reduced.keyboard.press("Escape");
  await dialog(reduced).waitFor({ state: "hidden" });
  await capture("reduced-motion", reduced);
  assert.equal(
    await reduced.evaluate(() => localStorage.length + sessionStorage.length),
    0,
  );
  await reducedContext.close();
  check("Reduced motion freezes reactive tilt and removes lift and dialog entrance movement");

  assert.deepEqual(errors, []);
  assert.equal(
    await page.evaluate(() => localStorage.length + sessionStorage.length),
    0,
  );
  const expectedOrigin = new URL(baseURL).origin;
  assert.ok(
    requests.every((url) => new URL(url).origin === expectedOrigin),
    "All browser requests remain on the Structor origin",
  );
  assert.ok(
    requests.every((url) => !new URL(url).pathname.startsWith("/api/")),
    "The board makes no API calls",
  );
  check("No runtime errors, external calls, API calls, or browser storage writes");

  console.log(JSON.stringify({ checks, screenshots: output }, null, 2));
} catch (error) {
  await capture("failure", page);
  console.error("Screenshots:", output);
  throw error;
} finally {
  await browser.close();
}
