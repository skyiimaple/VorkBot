import { describe, expect, it } from "vitest";
import {
  AGENTS_COMPUTER_TOOL_DEFINITIONS,
  parseAgentsComputerToolCall
} from "./agents-computer-tools.js";

describe("Agents computer function tools", () => {
  it("publishes file, terminal and browser tools as strict function definitions", () => {
    const names = AGENTS_COMPUTER_TOOL_DEFINITIONS.map((tool) => tool.name);

    expect(names).toContain("vork_file_read");
    expect(names).toContain("vork_terminal_start");
    expect(names).toContain("vork_browser_navigate");
    expect(AGENTS_COMPUTER_TOOL_DEFINITIONS.every((tool) =>
      tool.type === "function" && tool.parameters.additionalProperties === false
    )).toBe(true);
  });

  it("maps function names and arguments to the existing AgentToolAction protocol", () => {
    expect(parseAgentsComputerToolCall("vork_file_write", {
      path: "notes/today.md",
      content: "hello"
    })).toEqual({ type: "file.write", path: "notes/today.md", content: "hello" });

    expect(parseAgentsComputerToolCall("vork_terminal_read", {
      sessionId: "term_1",
      cursor: 12
    })).toEqual({ type: "terminal.read", sessionId: "term_1", cursor: 12 });

    expect(parseAgentsComputerToolCall("vork_browser_click", { ref: "button-1" }))
      .toEqual({ type: "browser.click", ref: "button-1" });
  });

  it("rejects unknown functions and invalid arguments", () => {
    expect(() => parseAgentsComputerToolCall("vork_unknown", {})).toThrow("UNKNOWN_AGENTS_TOOL");
    expect(() => parseAgentsComputerToolCall("vork_file_read", {})).toThrow();
    expect(() => parseAgentsComputerToolCall("vork_browser_scroll", { deltaY: 1.5 })).toThrow();
  });
});
