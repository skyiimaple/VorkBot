import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import App from "../../App.js";
import { createFakeVorkApi } from "../../test/fake-vork-api.js";

afterEach(() => {
  cleanup();
});

describe("new chat recipient picker", () => {
  it("opens the recipient picker and creates a temporary Bot", async () => {
    const api = createFakeVorkApi();
    const user = userEvent.setup();

    render(<App api={api} memory />);
    expect(await screen.findByRole("button", { name: "新建聊天" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "新建聊天" }));
    expect(screen.getByRole("combobox", { name: "收件人" })).toBeTruthy();
    await user.click(screen.getByRole("option", { name: "创建新 Bot" }));

    expect(api.createBot).toHaveBeenCalledWith({ name: "新建 Bot", persona: "待通过对话设置" });
    expect(await screen.findByRole("heading", { name: "新建 Bot" })).toBeTruthy();
  });

  it("creates a Bot using the typed recipient name", async () => {
    const api = createFakeVorkApi();
    const user = userEvent.setup();

    render(<App api={api} memory />);
    expect(await screen.findByRole("button", { name: "新建聊天" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "新建聊天" }));
    await user.type(screen.getByRole("combobox", { name: "收件人" }), "研究助手");
    await user.click(screen.getByRole("option", { name: "创建新 Bot" }));

    expect(api.createBot).toHaveBeenCalledWith({ name: "研究助手", persona: "待通过对话设置" });
    expect(await screen.findByRole("heading", { name: "研究助手" })).toBeTruthy();
  });

  it("supports creating a Bot with the keyboard", async () => {
    const api = createFakeVorkApi();
    const user = userEvent.setup();

    render(<App api={api} memory />);
    expect(await screen.findByRole("button", { name: "新建聊天" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "新建聊天" }));
    expect(screen.getByRole("combobox", { name: "收件人" })).toBeTruthy();
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("heading", { name: "新建 Bot" })).toBeTruthy();
  });

  it("restores and reopens an existing conversation without creating another one", async () => {
    const api = createFakeVorkApi();
    await api.request({ operation: "createBot", input: { name: "已保存 Bot", persona: "已有对话" } });
    api.request.mockClear();
    const user = userEvent.setup();

    render(<App api={api} memory />);
    expect(await screen.findByRole("button", { name: "已保存 Bot" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "已保存 Bot" }));
    expect(await screen.findByRole("heading", { name: "已保存 Bot" })).toBeTruthy();

    expect(api.request).not.toHaveBeenCalledWith({ operation: "createConversation", input: { botId: "bot_1" } });
  });
});
