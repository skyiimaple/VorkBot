import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { FastifyInstance } from "fastify";
import { chromium } from "playwright";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildComputerApp } from "../server.js";

const token = "test-token";
const testPageUrl = pathToFileURL(
  join(dirname(fileURLToPath(import.meta.url)), "../../../public/test-page/index.html")
).href;

async function chromiumAvailable(): Promise<boolean> {
  try {
    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    await browser.close();
    return true;
  } catch {
    return false;
  }
}

describe("browser integration", () => {
  let app: FastifyInstance;
  let workspaceRoot: string;
  let profilesRoot: string;
  let leaseId: string;
  let slotId: string;
  let hasBrowser = false;

  beforeAll(async () => {
    hasBrowser = await chromiumAvailable();
  });

  beforeEach(async (context) => {
    if (!hasBrowser) {
      context.skip();
      return;
    }

    workspaceRoot = await mkdtemp(join(tmpdir(), "vork-workspace-"));
    profilesRoot = await mkdtemp(join(tmpdir(), "vork-profiles-"));
    app = buildComputerApp({
      token,
      maxSlots: 1,
      workspaceRoot,
      browserProfilesRoot: profilesRoot
    });

    const acquire = await app.inject({
      method: "POST",
      url: "/v1/slots/acquire",
      headers: { authorization: `Bearer ${token}` },
      payload: { taskId: "task_browser", botId: "bot_1", kind: "browser" }
    });
    expect(acquire.statusCode).toBe(200);
    leaseId = acquire.json().leaseId;
    slotId = acquire.json().slotId;
  });

  afterEach(async () => {
    if (!hasBrowser || !app) return;
    await app.inject({
      method: "POST",
      url: "/v1/slots/release",
      headers: { authorization: `Bearer ${token}` },
      payload: { leaseId }
    });
    await app.close();
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(profilesRoot, { recursive: true, force: true });
  });

  it("navigates the test page, observes elements, clicks, and releases", async () => {
    const navigate = await app.inject({
      method: "POST",
      url: "/v1/browser/navigate",
      headers: { authorization: `Bearer ${token}` },
      payload: { leaseId, url: testPageUrl }
    });
    expect(navigate.statusCode).toBe(200);

    const observe = await app.inject({
      method: "POST",
      url: "/v1/browser/observe",
      headers: { authorization: `Bearer ${token}` },
      payload: { leaseId }
    });
    expect(observe.statusCode).toBe(200);
    const observed = observe.json();
    expect(observed.title).toBe("Vork Browser Test");
    expect(observed.elements.some((element: { tag?: string }) => element.tag === "button")).toBe(true);

    const button = observed.elements.find((element: { tag?: string }) => element.tag === "button");
    expect(button?.ref).toBeTruthy();

    const click = await app.inject({
      method: "POST",
      url: "/v1/browser/click",
      headers: { authorization: `Bearer ${token}` },
      payload: { leaseId, ref: button.ref }
    });
    expect(click.statusCode).toBe(200);

    const frame = await app.inject({
      method: "GET",
      url: `/v1/slots/${encodeURIComponent(slotId)}/frame?leaseId=${encodeURIComponent(leaseId)}`,
      headers: { authorization: `Bearer ${token}` }
    });
    expect(frame.statusCode).toBe(200);
    expect(frame.headers["content-type"]).toContain("image/jpeg");
    expect(frame.rawPayload.byteLength).toBeGreaterThan(100);

    const release = await app.inject({
      method: "POST",
      url: "/v1/slots/release",
      headers: { authorization: `Bearer ${token}` },
      payload: { leaseId }
    });
    expect(release.statusCode).toBe(204);
  }, 60_000);
});
