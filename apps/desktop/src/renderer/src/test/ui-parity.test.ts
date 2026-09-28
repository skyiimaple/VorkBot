/**
 * Desktop 包内轻量断言：与 scripts/ui-parity/checklist.json 对齐的关键文案/结构。
 * 不依赖 Grok asar；完整对照请跑 `pnpm ui:check`。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const desktopSrc = path.join(root, "apps/desktop/src/renderer/src");

function readRel(rel: string): string {
  return readFileSync(path.join(desktopSrc, rel), "utf8");
}

describe("ui parity (static, Vork-only)", () => {
  it("侧栏：未分组可折叠 + 关键右键文案集合", () => {
    const sidebar = readRel("features/navigation/Sidebar.tsx");
    const store = readRel("stores/ui-store.ts");

    expect(store).toContain("ungroupedCollapsed");
    expect(store).toContain("toggleUngroupedCollapsed");
    expect(sidebar).toContain("未分组");
    expect(sidebar).toContain("toggleUngroupedCollapsed");
    // Grok sand-agents-section__header parity
    expect(sidebar).toContain("sand-agents-section__header");
    expect(sidebar).toContain("SectionHeaderButton");
    expect(sidebar).toContain("h-[30px]");
    expect(sidebar).toContain("rotate-90");
    expect(sidebar).toContain("group-hover/section:opacity-100");

    for (const label of [
      "重命名 Bot",
      "置顶",
      "取消置顶",
      "静音",
      "取消静音",
      "标为未读",
      "标为已读",
      "分组操作",
      "重命名分组",
      "新建分组"
    ]) {
      expect(sidebar, label).toContain(label);
    }
  });

  it("侧栏：移动/隐藏相关菜单项存在（措辞与 Grok 的完整对齐由 pnpm ui:check 负责）", () => {
    const sidebar = readRel("features/navigation/Sidebar.tsx");
    expect(sidebar).toMatch(/移至|移到/);
    expect(sidebar).toMatch(/移至新分组|移到新分区/);
    expect(sidebar).toMatch(/从侧边栏隐藏|从侧栏隐藏/);
    expect(sidebar).toMatch(/未分组|对话（默认）/);
  });

  it("设置弹窗固定高度 + 系统设置标题", () => {
    const settings = readRel("features/settings/SettingsDialog.tsx");
    expect(settings).toContain("h-[min(86vh,32rem)]");
    expect(settings).toContain("overflow-hidden");
    expect(settings).toContain("系统设置");
  });

  it("聊天 stick-to-bottom + scrollbar-grok", () => {
    const chat = readRel("features/chat/ConversationView.tsx");
    const stick = readRel("features/chat/useStickToBottom.ts");
    expect(stick).toContain("STICK_THRESHOLD_PX");
    expect(stick).toContain("showJumpToLatest");
    expect(chat).toContain("useStickToBottom");
    expect(chat).toContain("新消息");
    expect(chat).toContain("思考中");
    expect(chat).not.toContain("最新消息");
    expect(chat).not.toContain("让我想想");
    expect(chat).toContain("scrollbar-grok");
    expect(chat).toContain("overflow-y-auto");
    expect(chat).toContain("bg-user-bubble");
    expect(chat).toContain("bg-agent-bubble");
    expect(chat).toContain("开始使用");
  });

  it("composer placeholder 对齐 Grok nltiqa（给 {Bot} 发消息）", () => {
    const composer = readRel("features/chat/MessageComposer.tsx");
    expect(composer).toContain("`给 ${recipient} 发消息`");
    expect(composer).toContain('aria-label="添加附件"');
    expect(composer).toContain("<Plus");
  });

  it("stick threshold 对齐 Grok nearBottomThresholdPx:4", () => {
    const stick = readRel("features/chat/useStickToBottom.ts");
    expect(stick).toContain("STICK_THRESHOLD_PX = 4");
    expect(stick).toContain("scrollHeight - el.scrollTop - el.clientHeight");
  });

  it("CSS tokens 与 scrollbar-grok", () => {
    const css = readRel("styles/app.css");
    expect(css).toMatch(/#599ce7/i);
    expect(css).toContain("--sand-bg-base: #fcfcfc");
    expect(css).toContain("--sand-sidebar-width: 280px");
    expect(css).toContain("@utility scrollbar-grok");
    expect(css).toContain("width: 6px");
  });

  it("侧栏顶部：Grok header/search chrome（无顶栏新建分组）", () => {
    const sidebar = readRel("features/navigation/Sidebar.tsx");
    const css = readRel("styles/app.css");
    expect(sidebar).toContain("sand-agents-sidebar__header");
    expect(sidebar).toContain("sand-agents-sidebar__search");
    expect(sidebar).toContain("sand-agents-sidebar__footer");
    expect(sidebar).toContain("size-6");
    expect(sidebar).toContain("rounded-[6px]");
    expect(sidebar).toContain('placeholder="搜索"');
    expect(sidebar).toContain("shadow-[inset_0_0_0_0.5px_var(--sand-border-weak)]");
    expect(sidebar).toContain("app-region-drag");
    expect(sidebar).toContain("app-region-no-drag");
    // Grok: only + in header — no ⋯ / 侧栏操作 / 顶栏「新建分组」
    expect(sidebar).not.toContain("侧栏操作");
    expect(sidebar).not.toContain("MoreHorizontal");
    expect(sidebar).toContain("onNewSection");
    expect(sidebar).toContain("移至新分组");
    expect(sidebar).toContain("relativePreview");
    expect(css).toContain("--sand-fill-secondary-hover");
    expect(css).toContain("--sand-text-tertiary");
    expect(css).toContain("--sand-titlebar-block");
    expect(css).toContain("--sand-titlebar-inset");
    expect(css).toContain("@utility app-region-drag");
  });

  it("macOS 窗口：hiddenInset + traffic lights 对齐侧栏顶栏", () => {
    const windowSrc = readFileSync(
      path.join(root, "apps/desktop/src/main/window.ts"),
      "utf8"
    );
    expect(windowSrc).toContain('titleBarStyle: "hiddenInset"');
    expect(windowSrc).toContain("trafficLightPosition");
    expect(windowSrc).toMatch(/x:\s*16/);
    expect(windowSrc).toMatch(/y:\s*15/);
  });

  it("侧栏可拖宽：Grok min/max + resize handle + 持久化", () => {
    const shell = readRel("layouts/AppShell.tsx");
    const store = readRel("stores/ui-store.ts");
    const css = readRel("styles/app.css");
    expect(store).toContain("SIDEBAR_WIDTH_MIN = 240");
    expect(store).toContain("SIDEBAR_WIDTH_MAX = 400");
    expect(store).toContain("SIDEBAR_WIDTH_DEFAULT = 280");
    expect(store).toContain("sidebarWidth");
    expect(store).toContain("setSidebarWidth");
    expect(store).toContain("sidebarWidth: state.sidebarWidth");
    expect(shell).toContain("sand-sidebar-resize-handle");
    expect(shell).toContain('aria-label="调整侧栏宽度"');
    expect(shell).toContain("cursor-col-resize");
    expect(shell).toContain("insetInlineEnd: -6");
    expect(css).toContain('body[data-sidebar-resizing="true"]');
  });

  it("composer 与对话顶栏对齐 Grok", () => {
    const composer = readRel("features/chat/MessageComposer.tsx");
    const chat = readRel("features/chat/ConversationView.tsx");
    const home = readRel("routes/HomePage.tsx");
    expect(composer).toContain("rounded-[28px]");
    expect(composer).toContain('aria-label="停止"');
    expect(composer).toContain("botName");
    expect(chat).toContain("botName={botName}");
    expect(chat).toContain('aria-label="电脑"');
    expect(chat).not.toContain(">电脑</");
    expect(home).toContain("创建你的第一个 Bot");
  });
});
