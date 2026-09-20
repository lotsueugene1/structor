import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const baseURL =
  process.env.STRUCTOR_PREVIEW_URL ||
  process.env.TEST_BASE_URL ||
  "http://localhost:3000";
const output = await mkdtemp(join(tmpdir(), "structor-ui-"));
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const checks = [];
const check = (name) => {
  checks.push(name);
  console.log(`PASS ${name}`);
};
async function capture(name, fullPage = false) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: join(output, `${name}.png`),
    fullPage,
    animations: "disabled",
  });
}
const noOverflow = async () =>
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
const navigate = async (name) =>
  page
    .getByRole("navigation", { name: "Workspace navigation" })
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .click();
async function clickShape(locator) {
  const box = await locator.boundingBox();
  assert.ok(box, "Expected the canvas shape to be visible");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}
try {
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await page
    .getByRole("heading", {
      name: "Plan the system before you write the code.",
    })
    .waitFor();
  assert.equal(await page.locator(".project-library").count(), 0);
  assert.equal(await page.locator(".arch-node").count(), 0);
  assert.doesNotMatch(
    await page.locator("body").innerText(),
    /Frame|Explore demo|photographer|coming next|Stored in this browser|backup|No projects yet/i,
  );
  await noOverflow();
  await capture("landing-desktop", true);
  check(
    "Homepage has no workspace panel, demo architecture, or storage messaging",
  );

  await page
    .locator(".landing-hero")
    .getByRole("link", { name: "Start a project", exact: true })
    .click();
  await page.waitForURL(
    (url) => url.pathname === "/start" && url.search === "",
  );
  await page
    .getByRole("heading", {
      name: "What do you want to structure?",
      exact: true,
    })
    .waitFor();
  await page
    .getByLabel("Project description", { exact: true })
    .fill("Interface review. Check the architecture authoring interface.");
  await page
    .getByRole("button", { name: "Generate architecture", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForURL("**/workspace");
  await page
    .getByText("Define your first component", { exact: true })
    .waitFor();
  assert.equal(await page.locator(".arch-node").count(), 0);
  await capture("workspace-empty");
  check(
    "Onboarding opens an empty architecture using only user-entered intent",
  );

  await page
    .getByRole("button", { name: "Create first component", exact: true })
    .click();
  await page.getByLabel("Name", { exact: true }).fill("Research API");
  await page
    .getByLabel("Summary", { exact: true })
    .fill("Controls access to research records.");
  await page
    .getByLabel("Purpose", { exact: true })
    .fill("Manage the records owned by a research team.");
  await page
    .getByLabel("Security requirements", { exact: true })
    .fill("Only authorized team members may modify records.");
  await page
    .getByRole("button", { name: "Save component", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  const workspacePanel = page.getByRole("complementary", {
    name: "Research API workspace",
  });
  await workspacePanel.waitFor();
  await page.locator(".arch-node").first().waitFor();
  await workspacePanel
    .getByLabel("Propose a business rule", { exact: true })
    .fill("Archived records are read-only.");
  await workspacePanel
    .getByRole("button", { name: "Review rule", exact: true })
    .click();
  await page.getByText("Affected architecture", { exact: true }).waitFor();
  assert.ok(
    (await page.locator(".arch-node-affected").count()) > 0,
    "Pending patches highlight the affected component on the canvas",
  );
  await page
    .getByRole("button", { name: "Apply changes", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await workspacePanel
    .getByText("Archived records are read-only.", { exact: true })
    .waitFor();
  await capture("workspace-authored");
  await workspacePanel
    .getByRole("button", { name: "Close node workspace", exact: true })
    .click();
  check(
    "Component editing and rule review update frontend state without invented content",
  );

  for (const [name, projection] of [
    ["Security", "security"],
    ["Canvas", "system"],
  ]) {
    await navigate(name);
    await page
      .locator(`[data-projection="${projection}"][data-state="on"]`)
      .waitFor();
  }
  for (const name of ["Decisions", "Agent context"]) {
    await navigate(name);
    await page.locator(".workspace-document > h2").waitFor();
  }
  await navigate("Canvas");
  await page
    .getByRole("button", { name: "Search architecture", exact: true })
    .click();
  await page.getByRole("textbox", { name: "Search systems" }).fill("Research");
  await page.locator(".search-results > button").click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await workspacePanel.waitFor();
  await workspacePanel
    .getByRole("button", { name: "Close node workspace", exact: true })
    .click();
  await workspacePanel.waitFor({ state: "hidden" });
  const researchNode = page.locator(".arch-node").first();
  await clickShape(researchNode);
  await workspacePanel.waitFor();
  await page
    .getByRole("toolbar", { name: "Research API actions" })
    .getByRole("button", { name: "Open", exact: true })
    .waitFor();
  await workspacePanel
    .getByRole("button", { name: "Close node workspace", exact: true })
    .click();
  await workspacePanel.waitFor({ state: "hidden" });
  await clickShape(researchNode);
  await page.keyboard.press("Enter");
  await workspacePanel.waitFor();
  check("Workspace views, search, and keyboard component selection");

  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow();
  await capture("inspector-mobile");
  await page
    .getByRole("button", { name: "Edit Research API", exact: true })
    .click();
  await capture("editor-mobile");
  await noOverflow();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await page
      .getByRole("button", { name: "Review rule", exact: true })
      .evaluate((el) => getComputedStyle(el).transitionDuration),
    "1e-05s",
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  check("Mobile inspector/editor layout and reduced motion");

  assert.equal(await page.evaluate(() => localStorage.length), 0);
  assert.equal(await page.evaluate(() => sessionStorage.length), 0);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForURL(
    (url) => url.pathname === "/start" && url.search === "",
  );
  await page.getByLabel("Project description", { exact: true }).waitFor();
  check("No browser persistence: reloading the workspace returns to start");

  await page.goto(baseURL, { waitUntil: "networkidle" });
  await noOverflow();
  await capture("landing-mobile", true);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Animation.enable");
  await cdp.send("Animation.setPlaybackRate", { playbackRate: 0.1 });
  await page.getByRole("button", { name: "Open menu", exact: true }).click();
  await page.getByRole("navigation", { name: "Mobile navigation" }).waitFor();
  await page.waitForTimeout(3200);
  await capture("mobile-menu-slow-motion");
  await page.getByRole("button", { name: "Close menu", exact: true }).click();
  await cdp.send("Animation.setPlaybackRate", { playbackRate: 1 });
  check(
    "Mobile landing and navigation; menu motion checked at 10 percent speed",
  );
  assert.deepEqual(errors, []);
  check("No browser runtime errors");
  console.log(
    JSON.stringify({ checks: checks.length, screenshots: output }, null, 2),
  );
} catch (error) {
  await capture("failure");
  console.error("Screenshots:", output);
  throw error;
} finally {
  await browser.close();
}
