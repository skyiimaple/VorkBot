import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownContent } from "./MarkdownContent.js";

describe("MarkdownContent", () => {
  it("renders headings, bold, and inline code instead of raw markers", () => {
    render(
      <MarkdownContent content={"## 标题\n\n这是 **粗体** 与 `inline` 代码。"} />
    );

    expect(screen.getByRole("heading", { level: 2, name: "标题" })).toBeTruthy();
    expect(screen.getByText("粗体").tagName).toBe("STRONG");
    expect(screen.getByText("inline").tagName).toBe("CODE");
    expect(screen.queryByText(/\*\*/)).toBeNull();
    expect(screen.queryByText(/##/)).toBeNull();
  });

  it("renders fenced code with copy control", () => {
    render(
      <MarkdownContent
        content={"```ts\nconst x = 1;\n```"}
      />
    );

    expect(screen.getByText("复制代码")).toBeTruthy();
    expect(screen.getByText("ts")).toBeTruthy();
    const code = document.querySelector(".markdown-code-block code");
    expect(code?.textContent).toContain("const x = 1;");
  });
});
