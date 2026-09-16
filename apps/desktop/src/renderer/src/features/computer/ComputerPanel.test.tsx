import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ComputerPanel } from "./ComputerPanel.js";
import type { VorkApi } from "../../../../preload/api.js";

describe("ComputerPanel", () => {
  it("polls frames while open and stops when closed", async () => {
    const getComputerFrame = vi.fn(async () => ({
      base64: Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64")
    }));
    const api = { getComputerFrame } as unknown as VorkApi;

    const { rerender } = render(<ComputerPanel api={api} taskId="task_1" slotId="slot_1" open />);
    await waitFor(() => expect(getComputerFrame).toHaveBeenCalled());
    expect(await screen.findByAltText("云电脑画面")).toBeTruthy();

    const calls = getComputerFrame.mock.calls.length;
    rerender(<ComputerPanel api={api} taskId="task_1" slotId="slot_1" open={false} />);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(getComputerFrame.mock.calls.length).toBe(calls);
  });
});
