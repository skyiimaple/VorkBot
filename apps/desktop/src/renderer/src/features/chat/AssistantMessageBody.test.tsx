import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantMessageBody } from "./AssistantMessageBody.js";
import { STREAM_MARKDOWN_SETTLE_MS, TYPEWRITER_INTERVAL_MS } from "./useTypewriterReveal.js";

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

describe("AssistantMessageBody", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installFrameClock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("uses plain text while animating, then settles into markdown", () => {
    render(<AssistantMessageBody content={"## 标题\n\n**粗体**"} animate />);

    expect(document.querySelector("[data-streaming-plain='true']")).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 2, name: "标题" })).toBeNull();

    act(() => {
      for (let i = 0; i < 80; i += 1) {
        vi.advanceTimersByTime(TYPEWRITER_INTERVAL_MS);
      }
    });

    // 追齐后仍需 settle 窗口才会切 Markdown
    expect(document.querySelector("[data-streaming-plain='true']")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(STREAM_MARKDOWN_SETTLE_MS);
    });

    expect(document.querySelector("[data-streaming-plain='true']")).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "标题" })).toBeTruthy();
    expect(screen.getByText("粗体").tagName).toBe("STRONG");
  });

  it("renders markdown immediately for historical messages", () => {
    render(<AssistantMessageBody content={"## 历史\n\n`code`"} animate={false} />);
    expect(document.querySelector("[data-streaming-plain='true']")).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "历史" })).toBeTruthy();
    expect(screen.getByText("code").tagName).toBe("CODE");
  });
});
