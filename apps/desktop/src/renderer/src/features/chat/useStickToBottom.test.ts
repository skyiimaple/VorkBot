import { act, renderHook } from "@testing-library/react";
import { createRef, type RefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  STICK_THRESHOLD_PX,
  distanceFromBottom,
  isNearBottom,
  useStickToBottom
} from "./useStickToBottom.js";

function makeViewport(partial: {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}): HTMLDivElement {
  const el = document.createElement("div");
  Object.defineProperties(el, {
    scrollHeight: { configurable: true, get: () => partial.scrollHeight },
    clientHeight: { configurable: true, get: () => partial.clientHeight },
    scrollTop: {
      configurable: true,
      get: () => partial.scrollTop,
      set: (value: number) => {
        partial.scrollTop = value;
      }
    }
  });
  el.scrollTo = ((options?: ScrollToOptions | number) => {
    if (typeof options === "number") {
      partial.scrollTop = options;
      return;
    }
    if (options && typeof options.top === "number") {
      partial.scrollTop = options.top;
    }
  }) as HTMLDivElement["scrollTo"];
  return el;
}

describe("isNearBottom / distanceFromBottom", () => {
  it("treats within threshold as near-bottom", () => {
    const el = { scrollHeight: 1000, scrollTop: 880, clientHeight: 100 };
    expect(distanceFromBottom(el)).toBe(20);
    expect(isNearBottom(el)).toBe(true);
    expect(isNearBottom(el, 10)).toBe(false);
    expect(STICK_THRESHOLD_PX).toBeGreaterThanOrEqual(64);
  });

  it("treats far-from-bottom as not stuck", () => {
    const el = { scrollHeight: 2000, scrollTop: 100, clientHeight: 400 };
    expect(distanceFromBottom(el)).toBe(1500);
    expect(isNearBottom(el)).toBe(false);
  });
});

describe("useStickToBottom", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "requestAnimationFrame",
      (cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 0) as unknown as number
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("sticks and scrolls when near-bottom content grows", async () => {
    vi.useFakeTimers();
    const metrics = { scrollHeight: 800, scrollTop: 700, clientHeight: 100 };
    const viewport = makeViewport(metrics);
    const viewportRef = createRef<HTMLDivElement>() as RefObject<HTMLDivElement | null>;
    (viewportRef as { current: HTMLDivElement | null }).current = viewport;

    const { result } = renderHook(() => useStickToBottom(viewportRef));
    expect(result.current.showJumpToLatest).toBe(false);

    metrics.scrollHeight = 1200;
    act(() => {
      result.current.onContentGrow();
    });
    await act(async () => {
      vi.runAllTimers();
    });

    expect(metrics.scrollTop).toBe(1200);
    expect(result.current.showJumpToLatest).toBe(false);
  });

  it("does not steal scroll when user is reading history; jump restores stick", async () => {
    vi.useFakeTimers();
    const metrics = { scrollHeight: 2000, scrollTop: 200, clientHeight: 400 };
    const viewport = makeViewport(metrics);
    const viewportRef = createRef<HTMLDivElement>() as RefObject<HTMLDivElement | null>;
    (viewportRef as { current: HTMLDivElement | null }).current = viewport;

    const { result } = renderHook(() => useStickToBottom(viewportRef));

    act(() => {
      viewport.dispatchEvent(new Event("scroll"));
    });
    expect(result.current.showJumpToLatest).toBe(true);

    metrics.scrollHeight = 2600;
    const topBefore = metrics.scrollTop;
    act(() => {
      result.current.onContentGrow();
    });
    await act(async () => {
      vi.runAllTimers();
    });
    expect(metrics.scrollTop).toBe(topBefore);

    act(() => {
      result.current.jumpToLatest();
    });
    expect(metrics.scrollTop).toBe(metrics.scrollHeight);
    expect(result.current.showJumpToLatest).toBe(false);
  });

  it("forceStick re-enables stick-to-bottom (e.g. after send)", async () => {
    vi.useFakeTimers();
    const metrics = { scrollHeight: 2000, scrollTop: 100, clientHeight: 400 };
    const viewport = makeViewport(metrics);
    const viewportRef = createRef<HTMLDivElement>() as RefObject<HTMLDivElement | null>;
    (viewportRef as { current: HTMLDivElement | null }).current = viewport;

    const { result } = renderHook(() => useStickToBottom(viewportRef));
    act(() => {
      viewport.dispatchEvent(new Event("scroll"));
    });
    expect(result.current.showJumpToLatest).toBe(true);

    act(() => {
      result.current.forceStick();
    });
    await act(async () => {
      vi.runAllTimers();
    });
    expect(result.current.showJumpToLatest).toBe(false);
    expect(metrics.scrollTop).toBe(metrics.scrollHeight);
  });
});
