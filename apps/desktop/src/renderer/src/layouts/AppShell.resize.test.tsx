import { render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clampSidebarWidth,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  useUiStore
} from "@/stores/ui-store";

vi.mock("@tanstack/react-router", () => ({
  Outlet: () => <div data-testid="outlet" />,
  useNavigate: () => vi.fn(),
  useRouterState: (opts?: { select?: (s: { location: { pathname: string; searchStr: string } }) => unknown }) => {
    const state = { location: { pathname: "/", searchStr: "" } };
    return opts?.select ? opts.select(state) : state;
  }
}));

vi.mock("@/features/navigation/Sidebar", () => ({
  Sidebar: () => <aside data-testid="sidebar">sidebar</aside>
}));

vi.mock("@/features/settings/SettingsDialog", () => ({
  SettingsDialog: () => null
}));

vi.mock("@/features/workspace/useWorkspace", () => ({
  useBotsQuery: () => ({ data: [], isError: false }),
  useConversationsQuery: () => ({ data: [], isError: false })
}));

import { AppShell } from "./AppShell";

describe("clampSidebarWidth", () => {
  it("clamps to Grok 240–400", () => {
    expect(clampSidebarWidth(100)).toBe(SIDEBAR_WIDTH_MIN);
    expect(clampSidebarWidth(999)).toBe(SIDEBAR_WIDTH_MAX);
    expect(clampSidebarWidth(320.4)).toBe(320);
    expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_WIDTH_DEFAULT);
  });
});

describe("AppShell sidebar resize", () => {
  beforeEach(() => {
    useUiStore.setState({ sidebarWidth: SIDEBAR_WIDTH_DEFAULT });
    localStorage.clear();
    delete document.body.dataset.sidebarResizing;
  });

  function renderShell() {
    const view = render(<AppShell />);
    const handle = view.container.querySelector(".sand-sidebar-resize-handle");
    expect(handle).toBeTruthy();
    const main = view.container.querySelector("main");
    expect(main).toBeTruthy();
    return { handle: handle as HTMLElement, main: main as HTMLElement, ...view };
  }

  it("drags the right-edge handle and persists width", async () => {
    const user = userEvent.setup();
    const { handle, main } = renderShell();
    expect(main.style.getPropertyValue("--sand-sidebar-width")).toBe("280px");

    await user.pointer([
      { keys: "[MouseLeft>]", target: handle, coords: { clientX: 280, clientY: 40, x: 280, y: 40 } },
      { coords: { clientX: 340, clientY: 40, x: 340, y: 40 } },
      { keys: "[/MouseLeft]" }
    ]);

    await waitFor(() => {
      expect(useUiStore.getState().sidebarWidth).toBe(340);
    });
    expect(main.style.getPropertyValue("--sand-sidebar-width")).toBe("340px");

    const raw = localStorage.getItem("vork-ui-store-v2");
    expect(raw).toBeTruthy();
    expect(raw).toContain('"sidebarWidth":340');
  });

  it("respects min and max while dragging", async () => {
    const user = userEvent.setup();
    const { handle, main } = renderShell();

    await user.pointer([
      { keys: "[MouseLeft>]", target: handle, coords: { clientX: 280, clientY: 40, x: 280, y: 40 } },
      { coords: { clientX: 0, clientY: 40, x: 0, y: 40 } }
    ]);
    expect(main.style.getPropertyValue("--sand-sidebar-width")).toBe(`${SIDEBAR_WIDTH_MIN}px`);

    await user.pointer([{ coords: { clientX: 2000, clientY: 40, x: 2000, y: 40 } }, { keys: "[/MouseLeft]" }]);
    expect(main.style.getPropertyValue("--sand-sidebar-width")).toBe(`${SIDEBAR_WIDTH_MAX}px`);
    expect(useUiStore.getState().sidebarWidth).toBe(SIDEBAR_WIDTH_MAX);
  });

  it("applies persisted sidebarWidth to CSS variable", () => {
    useUiStore.setState({ sidebarWidth: 360 });
    const { main } = renderShell();
    expect(main.style.getPropertyValue("--sand-sidebar-width")).toBe("360px");
  });
});
