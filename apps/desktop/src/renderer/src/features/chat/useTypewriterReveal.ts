import { useEffect, useRef, useState } from "react";

/**
 * 总体时长与「1 字 / 28ms」同级（≈36 字/秒）；用 rAF + 小数累计让推进更跟手。
 * 落后追赶按倍率放大 CPS，但仍远低于整段瞬间刷完。
 */
export const TYPEWRITER_INTERVAL_MS = 28;
export const TYPEWRITER_CHARS_BASE = 1;
export const TYPEWRITER_CHARS_CATCH_UP = 2;
export const TYPEWRITER_CHARS_FAST = 4;
export const TYPEWRITER_CATCH_UP_BEHIND = 80;
export const TYPEWRITER_FAST_BEHIND = 220;

export const TYPEWRITER_CPS_BASE = (TYPEWRITER_CHARS_BASE * 1000) / TYPEWRITER_INTERVAL_MS;
export const TYPEWRITER_CPS_CATCH_UP = (TYPEWRITER_CHARS_CATCH_UP * 1000) / TYPEWRITER_INTERVAL_MS;
export const TYPEWRITER_CPS_FAST = (TYPEWRITER_CHARS_FAST * 1000) / TYPEWRITER_INTERVAL_MS;

/** 流式追齐后稍等再切 Markdown，避免 chunk 间隙 Markdown↔纯文本闪烁。 */
export const STREAM_MARKDOWN_SETTLE_MS = 140;

/**
 * 展示层平滑揭示：目标全文可立刻到位（不影响 SSE/模型首包），UI 按节奏追赶。
 * `animate === false` 时立即显示全文（历史消息）。
 * `animate === true` 时从空开始追赶，即使上游已结束也继续打完。
 */
export function charsPerSecond(behind: number): number {
  if (behind <= 0) return 0;
  if (behind >= TYPEWRITER_FAST_BEHIND) return TYPEWRITER_CPS_FAST;
  if (behind >= TYPEWRITER_CATCH_UP_BEHIND) return TYPEWRITER_CPS_CATCH_UP;
  return TYPEWRITER_CPS_BASE;
}

/** @deprecated 兼容旧测试命名；等价于「每 28ms 应推进的字数」。 */
export function charsPerTick(behind: number): number {
  if (behind <= 0) return 0;
  if (behind >= TYPEWRITER_FAST_BEHIND) return TYPEWRITER_CHARS_FAST;
  if (behind >= TYPEWRITER_CATCH_UP_BEHIND) return TYPEWRITER_CHARS_CATCH_UP;
  return TYPEWRITER_CHARS_BASE;
}

export function useTypewriterReveal(fullText: string, animate: boolean): string {
  const [shownLength, setShownLength] = useState(() => (animate ? 0 : fullText.length));
  const shownRef = useRef(shownLength);
  const fracRef = useRef(animate ? 0 : fullText.length);
  const fullRef = useRef(fullText);
  fullRef.current = fullText;

  useEffect(() => {
    if (!animate) {
      shownRef.current = fullText.length;
      fracRef.current = fullText.length;
      setShownLength(fullText.length);
      return;
    }
    // 全文变短（极少见）时钳制；变长时继续从当前进度追。
    if (fracRef.current > fullText.length) {
      fracRef.current = fullText.length;
      shownRef.current = fullText.length;
      setShownLength(fullText.length);
    }
  }, [animate, fullText]);

  useEffect(() => {
    if (!animate) return;

    let raf = 0;
    let last = performance.now();
    let alive = true;

    const tick = (now: number) => {
      if (!alive) return;
      const full = fullRef.current;
      let frac = fracRef.current;
      if (frac > full.length) frac = full.length;

      const behind = full.length - frac;
      if (behind > 0) {
        const dt = Math.min(48, Math.max(0, now - last));
        last = now;
        frac = Math.min(full.length, frac + (charsPerSecond(behind) * dt) / 1000);
        fracRef.current = frac;
        const next = Math.floor(frac);
        if (next !== shownRef.current) {
          shownRef.current = next;
          setShownLength(next);
        }
      } else {
        last = now;
        if (shownRef.current !== full.length) {
          shownRef.current = full.length;
          fracRef.current = full.length;
          setShownLength(full.length);
        }
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [animate]);

  return fullText.slice(0, Math.min(shownLength, fullText.length));
}
