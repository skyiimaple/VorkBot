import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";

export type BrowserElement = {
  ref: string;
  role?: string;
  name?: string;
  tag?: string;
  testId?: string;
};

export type ObserveResult = {
  pageId: string;
  url: string;
  title: string;
  loadState: "loading" | "loaded" | "unknown";
  elements: BrowserElement[];
  consoleErrors: string[];
};

export type BrowserSessionOptions = {
  slotId: string;
  profileDir: string;
  crashRetryIntervalMs?: number;
  maxCrashRetries?: number;
  onRecovered?: () => void;
  onCrashFailed?: () => void;
};

const NAVIGATE_TIMEOUT_MS = 30_000;
const ACTION_TIMEOUT_MS = 10_000;

export class BrowserSession {
  readonly #slotId: string;
  readonly #profileDir: string;
  readonly #crashRetryIntervalMs: number;
  readonly #maxCrashRetries: number;
  readonly #onRecovered?: () => void;
  readonly #onCrashFailed?: () => void;

  #context?: BrowserContext;
  #page?: Page;
  #pageId = "page_1";
  #consoleErrors: string[] = [];
  #refSelectors = new Map<string, string>();
  #crashCount = 0;
  #recovering = false;

  constructor(options: BrowserSessionOptions) {
    this.#slotId = options.slotId;
    this.#profileDir = options.profileDir;
    this.#crashRetryIntervalMs = options.crashRetryIntervalMs ?? 2_000;
    this.#maxCrashRetries = options.maxCrashRetries ?? 3;
    this.#onRecovered = options.onRecovered;
    this.#onCrashFailed = options.onCrashFailed;
  }

  get slotId(): string {
    return this.#slotId;
  }

  async start(): Promise<void> {
    if (this.#context) {
      return;
    }
    await this.#launchBrowser();
  }

  async stop(): Promise<void> {
    this.#refSelectors.clear();
    this.#consoleErrors = [];
    await this.#context?.close().catch(() => undefined);
    this.#context = undefined;
    this.#page = undefined;
    this.#crashCount = 0;
  }

  async observe(): Promise<ObserveResult> {
    const page = await this.#ensurePage();
    this.#refSelectors.clear();

    const elements: BrowserElement[] = [];
    let index = 1;

    const interactive = await page.locator("button, a, input, textarea, select, [role='button']").all();
    for (const locator of interactive) {
      if (!(await locator.isVisible().catch(() => false))) {
        continue;
      }

      const ref = `el_${index}`;
      index += 1;
      const tag = await locator.evaluate((node) => node.tagName.toLowerCase()).catch(() => undefined);
      const testId = await locator.getAttribute("data-testid").catch(() => null);
      const name =
        (await locator.getAttribute("aria-label").catch(() => null)) ??
        (await locator.getAttribute("placeholder").catch(() => null)) ??
        (await locator.textContent().catch(() => null))?.trim() ??
        undefined;
      const role = await locator.getAttribute("role").catch(() => tag === "button" ? "button" : undefined);

      const selector = testId
        ? `[data-testid="${testId}"]`
        : tag && name
          ? `${tag}:has-text("${name.replace(/"/g, '\\"')}")`
          : tag
            ? `${tag}:nth-of-type(${index})`
            : `[data-vork-ref="${ref}"]`;

      await locator.evaluate((node, refValue) => {
        node.setAttribute("data-vork-ref", refValue);
      }, ref).catch(() => undefined);

      this.#refSelectors.set(ref, `[data-vork-ref="${ref}"]`);
      elements.push({ ref, role: role ?? undefined, name, tag, testId: testId ?? undefined });
    }

    return {
      pageId: this.#pageId,
      url: page.url(),
      title: await page.title().catch(() => ""),
      loadState: await this.#loadState(page),
      elements,
      consoleErrors: [...this.#consoleErrors]
    };
  }

  async navigate(url: string): Promise<void> {
    const page = await this.#ensurePage();
    await page.goto(url, { timeout: NAVIGATE_TIMEOUT_MS, waitUntil: "domcontentloaded" });
  }

  async click(ref: string): Promise<void> {
    const page = await this.#ensurePage();
    const selector = this.#selectorFor(ref);
    await page.locator(selector).click({ timeout: ACTION_TIMEOUT_MS });
  }

  async type(ref: string, text: string): Promise<void> {
    const page = await this.#ensurePage();
    const selector = this.#selectorFor(ref);
    await page.locator(selector).fill(text, { timeout: ACTION_TIMEOUT_MS });
  }

  async scroll(deltaY = 400): Promise<void> {
    const page = await this.#ensurePage();
    await page.mouse.wheel(0, deltaY);
  }

  async #ensurePage(): Promise<Page> {
    if (!this.#page) {
      await this.start();
    }
    if (!this.#page) {
      throw new Error("browser_unavailable");
    }
    return this.#page;
  }

  #selectorFor(ref: string): string {
    const selector = this.#refSelectors.get(ref);
    if (!selector) {
      throw new Error("stale_element_ref");
    }
    return selector;
  }

  async #launchBrowser(): Promise<void> {
    await mkdir(this.#profileDir, { recursive: true });
    this.#context = await chromium.launchPersistentContext(this.#profileDir, {
      headless: true,
      viewport: { width: 1280, height: 720 },
      args: ["--no-sandbox", "--disable-dev-shm-usage"]
    });
    this.#context.on("close", () => {
      void this.#handleCrash();
    });
    this.#page = this.#context.pages()[0] ?? (await this.#context.newPage());
    this.#page.on("console", (message) => {
      if (message.type() === "error") {
        this.#consoleErrors.push(message.text());
      }
    });
    this.#page.on("crash", () => {
      void this.#handleCrash();
    });
  }

  async #handleCrash(): Promise<void> {
    if (this.#recovering) {
      return;
    }
    this.#recovering = true;
    try {
      await Promise.resolve(this.#context?.close()).catch(() => undefined);
      this.#context = undefined;
      this.#page = undefined;

      while (this.#crashCount < this.#maxCrashRetries) {
        this.#crashCount += 1;
        await new Promise((resolve) => setTimeout(resolve, this.#crashRetryIntervalMs));
        try {
          await this.#launchBrowser();
          this.#onRecovered?.();
          return;
        } catch {
          // retry
        }
      }

      this.#onCrashFailed?.();
    } finally {
      this.#recovering = false;
    }
  }

  async #loadState(page: Page): Promise<ObserveResult["loadState"]> {
    try {
      return (await page.evaluate(() => document.readyState)) === "complete" ? "loaded" : "loading";
    } catch {
      return "unknown";
    }
  }
}

export class BrowserSessionRegistry {
  readonly #sessions = new Map<string, BrowserSession>();
  readonly #profileRoot: string;

  constructor(profileRoot: string) {
    this.#profileRoot = profileRoot;
  }

  getOrCreate(
    slotId: string,
    hooks?: Pick<BrowserSessionOptions, "onRecovered" | "onCrashFailed">
  ): BrowserSession {
    const existing = this.#sessions.get(slotId);
    if (existing) {
      return existing;
    }

    const session = new BrowserSession({
      slotId,
      profileDir: join(this.#profileRoot, slotId),
      ...hooks
    });
    this.#sessions.set(slotId, session);
    return session;
  }

  get(slotId: string): BrowserSession | undefined {
    return this.#sessions.get(slotId);
  }

  async stop(slotId: string): Promise<void> {
    const session = this.#sessions.get(slotId);
    if (!session) {
      return;
    }
    await session.stop();
    this.#sessions.delete(slotId);
  }
}
