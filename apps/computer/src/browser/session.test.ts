import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BrowserSession } from "./session.js";

const { launchPersistentContext } = vi.hoisted(() => ({
  launchPersistentContext: vi.fn()
}));

vi.mock("playwright", () => ({
  chromium: {
    launchPersistentContext
  }
}));

describe("BrowserSession", () => {
  let profileRoot = "";

  afterEach(async () => {
    launchPersistentContext.mockReset();
    if (profileRoot) {
      await rm(profileRoot, { recursive: true, force: true });
      profileRoot = "";
    }
  });

  it("shares one browser launch across concurrent start requests", async () => {
    profileRoot = await mkdtemp(join(tmpdir(), "vork-browser-"));
    let finishLaunch: ((context: unknown) => void) | undefined;
    const page = { on: vi.fn() };
    let closeHandler: (() => void) | undefined;
    const context = {
      pages: () => [page],
      newPage: async () => page,
      on: vi.fn((event: string, handler: () => void) => {
        if (event === "close") closeHandler = handler;
      }),
      close: vi.fn(async () => closeHandler?.())
    };
    launchPersistentContext.mockImplementation(() => new Promise((resolve) => {
      finishLaunch = resolve;
    }));
    const session = new BrowserSession({
      slotId: "slot_1",
      profileDir: join(profileRoot, "slot_1")
    });

    const first = session.start();
    const second = session.start();
    await vi.waitFor(() => expect(finishLaunch).toBeTypeOf("function"));
    finishLaunch?.(context);
    await Promise.all([first, second]);

    expect(launchPersistentContext).toHaveBeenCalledTimes(1);
    await session.stop();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(launchPersistentContext).toHaveBeenCalledTimes(1);
  });

  it("observes interactive elements after navigation", async () => {
    profileRoot = await mkdtemp(join(tmpdir(), "vork-browser-"));
    const click = vi.fn();
    const fill = vi.fn();
    const page = {
      url: () => "file:///app/public/test-page/index.html",
      title: async () => "Vork Browser Test",
      evaluate: async () => "complete",
      goto: vi.fn(),
      locator: (selector: string) => ({
        all: async () => [
          {
            isVisible: async () => true,
            evaluate: async (_fn: unknown, ref: string) => ref,
            getAttribute: async (name: string) => (name === "id" ? "action" : null),
            textContent: async () => "Click me"
          },
          {
            isVisible: async () => true,
            evaluate: async (_fn: unknown, ref: string) => ref,
            getAttribute: async (name: string) => (name === "id" ? "query" : "Type here"),
            textContent: async () => ""
          }
        ],
        click,
        fill
      }),
      on: vi.fn()
    };

    launchPersistentContext.mockResolvedValue({
      pages: () => [page],
      newPage: async () => page,
      on: vi.fn()
    });

    const session = new BrowserSession({
      slotId: "slot_1",
      profileDir: join(profileRoot, "slot_1")
    });

    await session.start();
    await session.navigate("file:///app/public/test-page/index.html");
    const observed = await session.observe();

    expect(observed.url).toContain("test-page");
    expect(observed.elements.length).toBeGreaterThanOrEqual(2);
    expect(observed.loadState).toBe("loaded");

    const buttonRef = observed.elements[0]?.ref;
    expect(buttonRef).toBeDefined();
    await session.click(buttonRef!);
    expect(click).toHaveBeenCalled();
  });

  it("invokes onCrashFailed when browser restart attempts are exhausted", async () => {
    profileRoot = await mkdtemp(join(tmpdir(), "vork-browser-"));
    const recovered = vi.fn();
    const failed = vi.fn();
    let closeHandler: (() => void) | undefined;
    let launchAttempts = 0;

    const makeContext = () => {
      const page = {
        url: () => "about:blank",
        title: async () => "",
        evaluate: async () => "complete",
        goto: vi.fn(),
        locator: () => ({
          all: async () => [],
          click: vi.fn(),
          fill: vi.fn()
        }),
        on: vi.fn()
      };

      return {
        pages: () => [page],
        newPage: async () => page,
        on: (event: string, handler: () => void) => {
          if (event === "close") {
            closeHandler = handler;
          }
        },
        close: vi.fn(async () => undefined)
      };
    };

    launchPersistentContext.mockImplementation(async () => {
      launchAttempts += 1;
      if (launchAttempts === 1) {
        return makeContext();
      }
      throw new Error("launch failed");
    });

    const session = new BrowserSession({
      slotId: "slot_1",
      profileDir: join(profileRoot, "slot_1"),
      crashRetryIntervalMs: 1,
      maxCrashRetries: 3,
      onRecovered: recovered,
      onCrashFailed: failed
    });

    await session.start();
    closeHandler?.();
    await vi.waitFor(() => expect(failed).toHaveBeenCalledTimes(1));

    expect(recovered).not.toHaveBeenCalled();
    expect(launchAttempts).toBeGreaterThan(1);
  });
});
