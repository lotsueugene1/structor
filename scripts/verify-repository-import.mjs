import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { deflateRawSync } from "node:zlib";

import { chromium } from "@playwright/test";

const baseURL = (process.env.TEST_BASE_URL || "http://localhost:3000").replace(
  /\/$/,
  "",
);
const apiURL = `${baseURL}/api/repositories/import`;
const fixtureRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "repository-import",
  "demo-next-repo",
);
const archiveName = "hackmit-roommate.zip";
const run = promisify(execFile);
const SECRET_SENTINELS = [
  "STRUCTOR_IMPORT_TEST_SECRET_DATABASE_URL",
  "STRUCTOR_IMPORT_TEST_PRIVATE_KEY_MUST_NOT_LEAVE_SCANNER",
  "STRUCTOR_IMPORT_TEST_NODE_MODULE_MUST_BE_IGNORED",
  "STRUCTOR_IMPORT_TEST_BUILD_OUTPUT_MUST_BE_IGNORED",
];

let checks = 0;

function check(name) {
  checks += 1;
  console.log(`PASS ${name}`);
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function zip(entries) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.isBuffer(entry.data)
      ? entry.data
      : Buffer.from(entry.data, "utf8");
    const method = entry.compress ? 8 : 0;
    const compressed = entry.compress ? deflateRawSync(data) : data;
    const flags = 0x0800 | (entry.encrypted ? 0x0001 : 0);
    const checksum = crc32(data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(flags, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, name, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(0x0314, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(flags, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, name);

    localOffset += localHeader.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);

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
    const filePath = relative(root, absolutePath).split(sep).join("/");
    entries.push({
      name: `demo-next-repo/${filePath}`,
      data: await readFile(absolutePath),
      compress: true,
    });
  }
  return entries.sort((left, right) => left.name.localeCompare(right.name));
}

async function responseJSON(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `Expected JSON from ${response.url}; received ${response.status}: ${text.slice(0, 300)}`,
    );
  }
}

async function upload(buffer, name = archiveName, type = "application/zip") {
  const form = new FormData();
  form.append("repository", new Blob([buffer], { type }), name);
  const response = await fetch(apiURL, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(45_000),
  });
  return { response, payload: await responseJSON(response) };
}

function nodeByName(payload, name) {
  const nodes = Object.values(payload.project.nodes);
  const match = nodes.find((node) => node.name === name);
  assert.ok(
    match,
    `Expected architecture area "${name}"; found ${nodes
      .map((node) => `"${node.name}"`)
      .join(", ")}`,
  );
  return match;
}

function allKeys(value, target = new Set()) {
  if (!value || typeof value !== "object") return target;
  if (Array.isArray(value)) {
    for (const item of value) allKeys(item, target);
    return target;
  }
  for (const [key, child] of Object.entries(value)) {
    target.add(key);
    allKeys(child, target);
  }
  return target;
}

async function expectRejectedArchive(buffer, code, status, name) {
  const result = await upload(buffer, name);
  assert.equal(result.response.status, status);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.error.code, code);
}

async function encryptedArchive() {
  const directory = await mkdtemp(join(tmpdir(), "structor-encrypted-zip-"));
  const archivePath = join(directory, "encrypted.zip");
  try {
    await writeFile(
      join(directory, "package.json"),
      '{"name":"encrypted-repository"}',
    );
    await run(
      "zip",
      ["-q", "-P", "structor-test-password", archivePath, "package.json"],
      { cwd: directory },
    );
    return await readFile(archivePath);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return null;
    }
    throw error;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function verifyAPI(repositoryZip, entries) {
  const chunkedResponse = await fetch(apiURL, {
    method: "POST",
    headers: {
      "content-type": "multipart/form-data; boundary=structor-boundary",
    },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode("--structor-boundary--\r\n"),
        );
        controller.close();
      },
    }),
    duplex: "half",
    signal: AbortSignal.timeout(15_000),
  });
  const chunkedPayload = await responseJSON(chunkedResponse);
  assert.equal(chunkedResponse.status, 411);
  assert.equal(chunkedPayload.error.code, "INVALID_MULTIPART");

  const plainResponse = await fetch(apiURL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(15_000),
  });
  const plainPayload = await responseJSON(plainResponse);
  assert.equal(plainResponse.status, 400);
  assert.equal(plainPayload.ok, false);
  assert.equal(plainPayload.error.code, "INVALID_MULTIPART");

  const wrongExtension = await upload(
    Buffer.from("not an archive"),
    "repository.txt",
    "text/plain",
  );
  assert.equal(wrongExtension.response.status, 415);
  assert.equal(wrongExtension.payload.error.code, "INVALID_FILE_TYPE");

  const fakeZip = await upload(
    Buffer.from("this is not a ZIP"),
    "repository.zip",
  );
  assert.equal(fakeZip.response.status, 415);
  assert.equal(fakeZip.payload.error.code, "INVALID_ZIP_SIGNATURE");
  check(
    "API rejects unverifiable, non-multipart, non-ZIP, and false-signature uploads",
  );

  const valid = await upload(repositoryZip);
  assert.equal(valid.response.status, 200);
  assert.equal(valid.response.headers.get("cache-control"), "no-store");
  assert.equal(valid.payload.ok, true);
  assert.equal(valid.payload.project.source, "repository");
  assert.equal(valid.payload.project.name, "hackmit-roommate");
  assert.equal(valid.payload.project.repository.fileName, archiveName);
  assert.equal(
    valid.payload.project.repository.repositoryRoot,
    "demo-next-repo",
  );
  assert.match(
    valid.payload.project.repository.importedAt,
    /^\d{4}-\d{2}-\d{2}T/,
  );
  assert.equal(valid.payload.manifest.project, "hackmit-roommate");
  assert.equal(valid.payload.manifest.repositoryRoot, "demo-next-repo");
  assert.ok(valid.payload.manifest.frameworks.includes("Next.js"));
  assert.ok(valid.payload.manifest.frameworks.includes("Prisma"));
  assert.ok(valid.payload.manifest.frameworks.includes("PostgreSQL"));
  assert.equal(valid.payload.stats.entriesDiscovered, entries.length);
  assert.equal(valid.payload.stats.filesDiscovered, entries.length);
  assert.equal(valid.payload.stats.analyzedFiles, 16);
  assert.equal(valid.payload.stats.ignoredFiles, 5);
  assert.equal(
    valid.payload.project.repository.analyzedFiles,
    valid.payload.stats.analyzedFiles,
  );
  check(
    "Valid ZIP reports real repository metadata, framework, and scan counts",
  );

  const nodes = Object.values(valid.payload.project.nodes);
  assert.ok(nodes.length >= 8, "Expected several semantic architecture areas");
  assert.ok(
    nodes.length < valid.payload.manifest.files.length,
    "Architecture must be semantic rather than one node per file",
  );
  assert.deepEqual(nodeByName(valid.payload, "Messages").implementation, [
    "src/app/api/messages/route.ts",
  ]);
  assert.deepEqual(
    nodeByName(valid.payload, "hackmit-roommate").implementation,
    ["next.config.ts", "package.json"],
  );
  assert.deepEqual(nodeByName(valid.payload, "Web interface").implementation, [
    "src/app/page.tsx",
  ]);
  assert.deepEqual(nodeByName(valid.payload, "Messaging").implementation, [
    "src/features/messaging/policy.ts",
    "src/features/messaging/service.ts",
    "src/features/messaging/types.ts",
  ]);
  assert.deepEqual(nodeByName(valid.payload, "Auth").implementation, [
    "src/features/auth/service.ts",
    "src/features/auth/session.ts",
  ]);
  assert.deepEqual(
    nodeByName(valid.payload, "Prisma data model").implementation,
    ["package.json", "prisma/schema.prisma"],
  );
  assert.deepEqual(
    nodeByName(valid.payload, "Application state").implementation,
    ["src/lib/store.ts"],
  );

  const manifestPaths = new Set(
    valid.payload.manifest.files.map((file) => file.path),
  );
  for (const node of nodes) {
    for (const implementationPath of node.implementation) {
      assert.ok(
        manifestPaths.has(implementationPath),
        `${implementationPath} must be backed by the scanned manifest`,
      );
    }
    assert.ok(
      !/identified from|declared in repository|boundary identified/i.test(
        node.summary,
      ),
      `${node.name} summary must describe the product, not the analysis: ${node.summary}`,
    );
    const expectedProvenance =
      node.parentId && /^(capability|page|api|data)$/.test(node.kind)
        ? "observed"
        : "inferred";
    assert.equal(
      node.provenance,
      expectedProvenance,
      `${node.name} provenance must distinguish observed evidence from inferred architecture`,
    );
  }
  assert.equal(nodeByName(valid.payload, "Messages").kind, "api");
  assert.equal(nodeByName(valid.payload, "Messaging").kind, "feature");
  assert.equal(nodeByName(valid.payload, "PostgreSQL").kind, "infrastructure");
  assert.equal(nodeByName(valid.payload, "Stripe").kind, "integration");
  check("Architecture nodes are semantic and cite exact scanned source paths");

  const ignoredPaths = [
    ".env",
    ".next/server/app.js",
    "node_modules/ignored-package/index.js",
    "package-lock.json",
    "secrets/demo-private-key.pem",
  ];
  for (const ignoredPath of ignoredPaths) {
    assert.equal(
      manifestPaths.has(ignoredPath),
      false,
      `${ignoredPath} is ignored`,
    );
  }
  const serialized = JSON.stringify(valid.payload);
  for (const sentinel of SECRET_SENTINELS) {
    assert.doesNotMatch(serialized, new RegExp(sentinel));
  }
  assert.doesNotMatch(serialized, /return conversation\.matchConfirmed/);
  const responseKeys = allKeys(valid.payload);
  for (const forbidden of [
    "archiveBuffer",
    "archiveSha256",
    "content",
    "contents",
    "rawSource",
    "repositoryZip",
    "sourceCode",
    "text",
  ]) {
    assert.equal(
      responseKeys.has(forbidden),
      false,
      `No ${forbidden} response field`,
    );
  }
  check(
    "Secrets, generated files, dependencies, lockfiles, and source contents stay out",
  );

  await expectRejectedArchive(
    zip([{ name: "../escape.ts", data: "export const escaped = true;" }]),
    "INVALID_ARCHIVE",
    422,
    "traversal.zip",
  );
  check("Path traversal ZIP is rejected");

  await expectRejectedArchive(
    zip([
      {
        name: "node_modules/example/package.json",
        data: '{"name":"must-not-be-analyzed"}',
      },
    ]),
    "NO_ANALYZABLE_FILES",
    422,
    "ignored-wrapper.zip",
  );
  await expectRejectedArchive(
    zip([
      {
        name: "secrets/config.json",
        data: '{"name":"must-not-be-analyzed"}',
      },
    ]),
    "NO_ANALYZABLE_FILES",
    422,
    "sensitive-directory.zip",
  );
  check(
    "Ignored wrapper roots and sensitive directories cannot bypass filters",
  );

  await expectRejectedArchive(
    zip([
      {
        name: "duplicate/package.json",
        data: '{"name":"first"}',
      },
      {
        name: "duplicate/package.json",
        data: '{"name":"second"}',
      },
    ]),
    "UNSAFE_ARCHIVE",
    422,
    "duplicate-paths.zip",
  );
  check("Duplicate normalized archive paths are rejected");

  const encryptedZip = await encryptedArchive();
  if (encryptedZip) {
    await expectRejectedArchive(
      encryptedZip,
      "UNSUPPORTED_ARCHIVE",
      422,
      "encrypted.zip",
    );
    check("Encrypted ZIP is rejected");
  } else {
    console.log(
      "SKIP Encrypted ZIP rejection: the system zip tool is unavailable",
    );
  }

  const oversizedZip = zip([
    {
      name: "oversized-repository/source.txt",
      data: Buffer.alloc(60 * 1024 * 1024 + 1, 0x41),
      compress: true,
    },
  ]);
  assert.ok(
    oversizedZip.length < 20 * 1024 * 1024,
    "Oversize fixture remains below the compressed upload limit",
  );
  await expectRejectedArchive(
    oversizedZip,
    "ARCHIVE_TOO_LARGE",
    413,
    "oversized.zip",
  );
  check("ZIP expanding beyond 60 MB is rejected before analysis");
}

async function verifyBrowser(repositoryZip) {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  const errors = [];
  page.setDefaultTimeout(30_000);
  page.on("pageerror", (error) => errors.push(error.message));

  try {
    await page.goto(`${baseURL}/start?mode=repository`, {
      waitUntil: "networkidle",
    });
    await page
      .getByRole("heading", { name: "Import repository", exact: true })
      .waitFor();
    await page.getByLabel("Choose repository ZIP").setInputFiles({
      name: archiveName,
      mimeType: "application/zip",
      buffer: repositoryZip,
    });
    await page.getByText(archiveName, { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Analyze repository", exact: true })
      .click();
    await page.getByText("Architecture draft ready", { exact: true }).waitFor();
    await page
      .getByText("Next.js + Prisma + PostgreSQL", { exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Open architecture", exact: true })
      .click();
    await page.waitForURL("**/workspace");
    await page
      .locator(".workspace-breadcrumb")
      .getByText("hackmit-roommate", { exact: true })
      .waitFor();
    async function clickShape(locator) {
      const box = await locator.boundingBox();
      assert.ok(box, "Expected the canvas shape to be visible");
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    }
    const graphNodes = page.locator(".arch-node");
    const boundaries = page.locator(".arch-boundary");
    await graphNodes.first().waitFor();
    assert.ok(
      (await graphNodes.count()) > 0,
      "Imported semantic nodes render on the workspace canvas",
    );
    assert.ok(
      (await boundaries.count()) >= 4,
      "Imported architecture is grouped into human boundaries",
    );
    for (const label of [
      "Experience",
      "Core systems",
      "Data",
      "Infrastructure",
      "External",
    ])
      await boundaries.getByText(label, { exact: true }).waitFor();
    const graphRows = await graphNodes.evaluateAll((elements) => [
      ...new Set(
        elements.map((element) =>
          Math.round(element.getBoundingClientRect().top / 20),
        ),
      ),
    ]);
    assert.ok(
      graphRows.length >= 3,
      `Expected a grouped multi-row graph; found ${graphRows.length} rows`,
    );
    await page
      .getByRole("button", { name: "Add component", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "Arrange", exact: true }).waitFor();
    await page
      .locator(".workspace-stats span")
      .nth(0)
      .filter({ hasText: /^\d+$/ })
      .waitFor();
    assert.ok(
      (await page.locator(".node-icon-brand").count()) >= 2,
      "Known services such as Stripe and PostgreSQL should show brand marks",
    );
    await page
      .locator(".arch-node")
      .filter({ hasText: "Stripe" })
      .locator('svg[aria-label="Stripe logo"]')
      .waitFor();
    const kinds = await graphNodes.evaluateAll((elements) => [
      ...new Set(elements.map((element) => element.dataset.nodeKind)),
    ]);
    assert.ok(
      kinds.length >= 4,
      `Architecture kinds should render as distinct shapes; found ${kinds.join(", ")}`,
    );
    assert.equal(
      await page.getByText("depends on", { exact: true }).count(),
      0,
      "Raw canonical relationship labels stay off the system overview",
    );
    assert.equal(
      await page.getByText("Active", { exact: true }).count(),
      0,
      "Cards must not show meaningless lifecycle badges",
    );
    assert.equal(
      await page.getByText(/identified from/i).count(),
      0,
      "Analysis-engine phrasing must not leak onto the canvas",
    );
    check("Imported architecture opens as grouped human system boundaries");

    async function dimmedShapeCount() {
      return page
        .locator('.tl-shape[data-shape-type="architecture-node"]')
        .evaluateAll(
          (elements) =>
            elements.filter(
              (element) =>
                Number.parseFloat(getComputedStyle(element).opacity) < 0.5,
            ).length,
        );
    }
    const messagingNode = graphNodes.filter({ hasText: "Messaging" }).first();
    await clickShape(messagingNode);
    await page
      .getByRole("complementary", { name: "Messaging workspace" })
      .waitFor();
    await page.waitForTimeout(150);
    assert.ok(
      (await dimmedShapeCount()) > 0,
      "Selecting a system should fade unrelated architecture",
    );
    await page
      .getByRole("toolbar", { name: "Messaging actions" })
      .getByRole("button", { name: "Ask AI", exact: true })
      .waitFor();
    await page.keyboard.press("Escape");
    await page.locator(".tl-canvas").click({ position: { x: 12, y: 420 } });
    await page.waitForTimeout(150);
    assert.equal(
      await dimmedShapeCount(),
      0,
      "Clearing the selection restores every system",
    );
    await page.locator('[data-projection="data"]').click();
    await boundaries.getByText("Owned data", { exact: true }).waitFor();
    await page.locator('[data-projection="flow"]').click();
    await page.getByText(/No explicit user journey is captured yet/).waitFor();
    assert.equal(
      await page.getByText("FOLLOW THE CONNECTIONS", { exact: true }).count(),
      0,
      "The workspace must not bypass projections with a raw edge dump",
    );
    await page.getByRole("button", { name: "Add flow", exact: true }).click();
    await page
      .getByRole("heading", { name: "Add flow", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.locator('[data-projection="system"]').click();
    await boundaries.getByText("Core systems", { exact: true }).waitFor();
    check(
      "Canvas projections reuse the canonical graph without inventing data",
    );

    const draggable = graphNodes.filter({ hasText: "Auth" }).first();
    const beforeDrag = await draggable.boundingBox();
    assert.ok(beforeDrag, "Expected a draggable architecture component");
    await page.mouse.move(
      beforeDrag.x + beforeDrag.width / 2,
      beforeDrag.y + beforeDrag.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      beforeDrag.x + beforeDrag.width / 2 + 90,
      beforeDrag.y + beforeDrag.height / 2 + 55,
      { steps: 10 },
    );
    await page.mouse.up();
    await page.waitForTimeout(250);
    const afterDrag = await draggable.boundingBox();
    assert.ok(afterDrag, "Expected the dragged component to remain visible");
    assert.ok(
      Math.abs(afterDrag.x - beforeDrag.x) > 40 ||
        Math.abs(afterDrag.y - beforeDrag.y) > 30,
      "Dragging a component should update its canvas position",
    );
    await page.keyboard.press("Escape");
    await page.locator(".tl-canvas").click({ position: { x: 12, y: 420 } });
    check("Canvas components can be repositioned smoothly");

    const relationshipCount = Number.parseInt(
      await page
        .locator('.workspace-stats span[title$="relationships"]')
        .innerText(),
      10,
    );
    assert.ok(Number.isInteger(relationshipCount));
    await page
      .getByRole("button", { name: "Add component", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Service", exact: true }).click();
    await page.getByRole("heading", { name: "Add component" }).waitFor();
    await page.getByLabel("Name", { exact: true }).fill("Notification worker");
    await page
      .getByLabel("Summary", { exact: true })
      .fill("Delivers queued product notifications.");
    await page
      .getByRole("button", { name: "Save component", exact: true })
      .click();

    const sourceNode = graphNodes.filter({ hasText: "Notification worker" });
    const targetNode = graphNodes.filter({ hasText: "Messaging" }).first();
    await sourceNode.waitFor();
    await targetNode.waitFor();
    await page
      .getByRole("complementary", { name: "Notification worker workspace" })
      .waitFor();
    await page.waitForTimeout(400);
    await page
      .getByRole("toolbar", { name: "Notification worker actions" })
      .getByRole("button", { name: "More actions" })
      .click();
    await page
      .getByRole("menuitem", {
        name: "Connect to another component",
        exact: true,
      })
      .click();
    const sourceBox = await sourceNode.boundingBox();
    const targetBox = await targetNode.boundingBox();
    assert.ok(sourceBox && targetBox, "Expected connectable components");
    await page.mouse.move(
      sourceBox.x + sourceBox.width / 2,
      sourceBox.y + sourceBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      targetBox.x + targetBox.width / 2,
      targetBox.y + targetBox.height / 2,
      { steps: 14 },
    );
    await page.mouse.up();
    await page.getByRole("heading", { name: "Add relationship" }).waitFor();
    await page
      .getByRole("button", { name: "Save relationship", exact: true })
      .click();
    await page
      .locator('.workspace-stats span[title$="relationships"]')
      .filter({ hasText: `${relationshipCount + 1}` })
      .waitFor();
    assert.equal(
      await page.locator('.tl-shape[data-shape-type="arrow"]').count(),
      0,
      "The system overview must not draw free relationship arrows unselected",
    );
    await clickShape(sourceNode);
    await page.locator('.tl-shape[data-shape-type="arrow"]').first().waitFor();
    assert.ok(
      (await page.locator('.tl-shape[data-shape-type="arrow"]').count()) > 0,
      "Selecting a component reveals its relationships as bound arrows",
    );
    check("Components can be created and connected directly on the canvas");

    await clickShape(sourceNode);
    const workspacePanel = page.getByRole("complementary", {
      name: "Notification worker workspace",
    });
    await workspacePanel.waitFor();
    await workspacePanel
      .getByLabel("Add business rule", { exact: true })
      .fill("Retry failed deliveries three times before alerting operators.");
    await workspacePanel
      .getByRole("button", { name: "Add business rule", exact: true })
      .waitFor({ state: "visible" });
    await workspacePanel
      .getByRole("button", { name: "Add business rule", exact: true })
      .evaluate((button) => {
        if (!(button instanceof HTMLButtonElement)) return false;
        return new Promise((resolve) => {
          const deadline = Date.now() + 10_000;
          const poll = () => {
            if (!button.disabled) return resolve(true);
            if (Date.now() > deadline) return resolve(false);
            setTimeout(poll, 100);
          };
          poll();
        });
      });
    await page
      .getByRole("complementary", { name: "Notification worker workspace" })
      .getByRole("button", { name: "Add business rule", exact: true })
      .click({ timeout: 10_000 });
    await workspacePanel
      .getByText(
        "Retry failed deliveries three times before alerting operators.",
        { exact: true },
      )
      .waitFor();
    await workspacePanel
      .getByRole("button", {
        name: /^Edit business rules: Retry failed deliveries/,
      })
      .click();
    await workspacePanel
      .getByLabel("Edit business rules", { exact: true })
      .fill("Retry failed deliveries five times before alerting operators.");
    await workspacePanel
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await workspacePanel
      .getByText(
        "Retry failed deliveries five times before alerting operators.",
        { exact: true },
      )
      .waitFor();
    await workspacePanel
      .getByRole("button", {
        name: /^Delete business rules: Retry failed deliveries five/,
      })
      .click();
    await workspacePanel
      .getByText("No business rules recorded.", { exact: true })
      .waitFor();
    check("Node Workspace edits canonical architecture manually");

    await workspacePanel.getByRole("tab", { name: "AI", exact: true }).click();
    await workspacePanel
      .getByLabel("Ask Structor about Notification worker", { exact: true })
      .fill(
        "add requirement: Deliveries must be idempotent per booking event.",
      );
    await workspacePanel
      .getByRole("button", { name: "Send", exact: true })
      .click();
    await workspacePanel
      .getByText("Added the requirement to Notification worker.", {
        exact: true,
      })
      .waitFor();
    await workspacePanel
      .getByRole("tab", { name: "Overview", exact: true })
      .click();
    await workspacePanel
      .getByText("Deliveries must be idempotent per booking event.", {
        exact: true,
      })
      .waitFor();
    await workspacePanel.getByRole("tab", { name: "AI", exact: true }).click();
    await workspacePanel
      .getByLabel("Ask Structor about Notification worker", { exact: true })
      .fill("create feature Delivery analytics");
    await workspacePanel
      .getByRole("button", { name: "Send", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Create Delivery analytics", exact: true })
      .waitFor();
    await page.getByText("Affected architecture", { exact: true }).waitFor();
    assert.ok(
      (await page.locator(".arch-node-affected").count()) > 0,
      "AI proposals should highlight affected systems on the canvas",
    );
    await page
      .getByRole("button", { name: "Apply changes", exact: true })
      .click();
    await graphNodes.filter({ hasText: "Delivery analytics" }).waitFor();
    check("Scoped Structor AI applies small edits and proposes impact patches");

    assert.deepEqual(errors, []);
    check("Browser uploads ZIP, analyzes it, and opens the imported workspace");
  } catch (error) {
    console.error("Browser URL:", page.url());
    console.error(
      "Browser text:",
      (
        await page
          .locator("body")
          .innerText()
          .catch(() => "<unavailable>")
      ).slice(0, 2_000),
    );
    console.error("Browser errors:", errors);
    throw error;
  } finally {
    await browser.close();
  }
}

let healthResponse;
try {
  healthResponse = await fetch(`${baseURL}/start?mode=repository`, {
    signal: AbortSignal.timeout(10_000),
  });
} catch (error) {
  throw new Error(
    `Structor is not reachable at ${baseURL}. Start the app before running this verifier.`,
    { cause: error },
  );
}
assert.equal(
  healthResponse.ok,
  true,
  `Structor returned ${healthResponse.status}`,
);

const entries = await fixtureEntries(fixtureRoot);
assert.equal(entries.length, 21, "The repository fixture changed unexpectedly");
const repositoryZip = zip(entries);
await verifyAPI(repositoryZip, entries);
await verifyBrowser(repositoryZip);

console.log(JSON.stringify({ checks, baseURL }, null, 2));
