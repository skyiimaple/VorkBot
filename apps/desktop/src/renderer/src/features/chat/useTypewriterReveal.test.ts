import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TYPEWRITER_CHARS_BASE,
  TYPEWRITER_CHARS_CATCH_UP,
  TYPEWRITER_CHARS_FAST,
  TYPEWRITER_CPS_BASE,
  TYPEWRITER_INTERVAL_MS,
  charsPerSecond,
  charsPerTick,
  useTypewriterReveal
} from "./useTypewriterReveal.js";

function installFrameClock() {
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal(
    "requestAnimationFrame",
    (cb: FrameRequestCallback) =>
      window.setTimeout(() => {
        now += TYPEWRITER_INTERVAL_MS;
        cb(now);
      }, TYPEWRITER_INTERVAL_MS) as unknown as number
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    window.clearTimeout(id);
  });
}

describe("charsPerTick / charsPerSecond", () => {
  it("keeps overall duration ~1 char / 28ms with gentle catch-up", () => {
    expect(TYPEWRITER_CHARS_BASE).toBe(1);
    expect(charsPerTick(1)).toBe(1);
    expect(charsPerTick(80)).toBe(TYPEWRITER_CHARS_CATCH_UP);
    expect(charsPerTick(80)).toBe(2);
    expect(charsPerTick(220)).toBe(TYPEWRITER_CHARS_FAST);
    expect(charsPerTick(220)).toBe(4);
    expect(charsPerSecond(1)).toBeCloseTo(TYPEWRITER_CPS_BASE, 5);
    expect(charsPerSecond(80)).toBeCloseTo((TYPEWRITER_CHARS_CATCH_UP * 1000) / TYPEWRITER_INTERVAL_MS, 5);
  });
});

describe("useTypewriterReveal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installFrameClock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("shows full text immediately when not animating", () => {
    const { result } = renderHook(() => useTypewriterReveal("完整回复", false));
    expect(result.current).toBe("完整回复");
  });

  it("reveals gradually while animating without dumping the whole string", () => {
    const { result } = renderHook(() => useTypewriterReveal("你好世界啊", true));

    expect(result.current).toBe("");

    act(() => {
      vi.advanceTimersByTime(TYPEWRITER_INTERVAL_MS);
    });
    expect(result.current.length).toBeGreaterThan(0);
    expect(result.current.length).toBeLessThan("你好世界啊".length);

    let guard = 0;
    while (result.current !== "你好世界啊" && guard < 40) {
      guard += 1;
      act(() => {
        vi.advanceTimersByTime(TYPEWRITER_INTERVAL_MS);
      });
    }
    expect(result.current).toBe("你好世界啊");
    expect(guard).toBeGreaterThan(2);
  });
});
