import { readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

import { chromium } from "@playwright/test";

const baseURL = (process.env.TEST_BASE_URL || "http://localhost:3000").replace(
  /\/$/,
  "",
);
const fixtureRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "repository-import",
  "demo-next-repo",
);
const output =
  process.env.SCREENSHOT_PATH || join(tmpdir(), "structor-workspace.png");

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1)
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer)
    value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
function zip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = entry.data;
    const compressed = deflateRawSync(data);
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}
async function fixtureEntries(directory, root = directory) {
  const entries = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, item.name);
    if (item.isDirectory()) {
      entries.push(...(await fixtureEntries(absolutePath, root)));
      continue;
    }
    if (!item.isFile()) continue;
    entries.push({
      name: `demo-next-repo/${relative(root, absolutePath).split(sep).join("/")}`,
      data: await readFile(absolutePath),
    });
  }
  return entries;
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const problems = [];
page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error" || message.type() === "warning")
    problems.push(`${message.type()}: ${message.text()}`);
});
try {
  await page.goto(`${baseURL}/start?mode=repository`, {
    waitUntil: "networkidle",
  });
  await page.getByLabel("Choose repository ZIP").setInputFiles({
    name: "hackmit-roommate.zip",
    mimeType: "application/zip",
    buffer: zip(await fixtureEntries(fixtureRoot)),
  });
  await page
    .getByRole("button", { name: "Analyze repository", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open architecture", exact: true })
    .click();
  await page.waitForURL("**/workspace");
  await page
    .getByRole("button", { name: "Add component", exact: true })
    .waitFor();
  await page.locator(".arch-node").first().waitFor();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: output });
  console.log(output);
  if (problems.length) console.log(problems.join("\n"));
} finally {
  await browser.close();
}
