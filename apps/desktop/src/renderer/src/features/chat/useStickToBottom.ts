import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/** 距底部小于该阈值时视为 near-bottom，内容增长应 stick。 */
export const STICK_THRESHOLD_PX = 96;

export type ScrollMetrics = Pick<HTMLElement, "scrollHeight" | "scrollTop" | "clientHeight">;

export function distanceFromBottom(el: ScrollMetrics): number {
  return el.scrollHeight - el.scrollTop - el.clientHeight;
}

export function isNearBottom(el: ScrollMetrics, thresholdPx: number = STICK_THRESHOLD_PX): boolean {
  return distanceFromBottom(el) <= thresholdPx;
}

/**
 * 对话列表 stick-to-bottom：
 * - near-bottom 时内容增长自动贴底
 * - 用户上翻时不抢滚动，露出「最新消息」入口
 * - jumpToLatest 平滑滚到底并恢复 stick
 */
export function useStickToBottom(viewportRef: RefObject<HTMLElement | null>) {
  const stickRef = useRef(true);
  const [nearBottom, setNearBottom] = useState(true);
  const scrollRafRef = useRef(0);
  const programmaticRef = useRef(false);

  const syncNearBottom = useCallback((next: boolean) => {
    stickRef.current = next;
    setNearBottom((prev) => (prev === next ? prev : next));
  }, []);

  const scrollViewportToBottom = useCallback(
    (behavior: ScrollBehavior) => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      programmaticRef.current = true;
      const top = viewport.scrollHeight;
      if (behavior === "smooth" && typeof viewport.scrollTo === "function") {
        viewport.scrollTo({ top, behavior: "smooth" });
      } else {
        viewport.scrollTop = top;
      }
      // smooth 期间仍视为 stick，避免中间帧把按钮闪出来
      syncNearBottom(true);
      if (behavior === "smooth") {
        window.setTimeout(() => {
          programmaticRef.current = false;
          const el = viewportRef.current;
          if (el) syncNearBottom(isNearBottom(el));
        }, 320);
      } else {
        // 等 scroll 事件派发后再放开，避免瞬时 onScroll 误判
        requestAnimationFrame(() => {
          programmaticRef.current = false;
        });
      }
    },
    [syncNearBottom, viewportRef]
  );

  const onContentGrow = useCallback(() => {
    if (!stickRef.current) return;
    if (scrollRafRef.current) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = 0;
      if (!stickRef.current) return;
      scrollViewportToBottom("auto");
    });
  }, [scrollViewportToBottom]);

  const forceStick = useCallback(() => {
    syncNearBottom(true);
    if (scrollRafRef.current) {
      cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = 0;
    }
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = 0;
      scrollViewportToBottom("auto");
    });
  }, [scrollViewportToBottom, syncNearBottom]);

  const jumpToLatest = useCallback(() => {
    syncNearBottom(true);
    scrollViewportToBottom("smooth");
  }, [scrollViewportToBottom, syncNearBottom]);

  useEffect(() => {
    let attached: HTMLElement | null = null;
    let raf = 0;

    const onScroll = () => {
      if (programmaticRef.current || !attached) return;
      syncNearBottom(isNearBottom(attached));
    };

    const attach = () => {
      const viewport = viewportRef.current;
      if (!viewport || viewport === attached) return;
      attached?.removeEventListener("scroll", onScroll);
      attached = viewport;
      viewport.addEventListener("scroll", onScroll, { passive: true });
      syncNearBottom(isNearBottom(viewport));
    };

    attach();
    // Radix Viewport 偶发晚一帧才挂上 ref
    raf = requestAnimationFrame(attach);

    return () => {
      cancelAnimationFrame(raf);
      attached?.removeEventListener("scroll", onScroll);
    };
  }, [syncNearBottom, viewportRef]);

  // 内容高度变化（打字机 / Markdown 切換）时：stick 则跟滚，否则只保持「最新消息」按钮
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      if (stickRef.current) onContentGrow();
    });

    const content = viewport.firstElementChild;
    if (content) observer.observe(content);
    observer.observe(viewport);

    return () => observer.disconnect();
  }, [onContentGrow, viewportRef]);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
    };
  }, []);

  return {
    nearBottom,
    showJumpToLatest: !nearBottom,
    onContentGrow,
    forceStick,
    jumpToLatest
  };
}
