import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { VorkApiProvider } from "@/features/chat/useConversation";
import { CredentialsPage } from "@/features/credentials/CredentialsPage";
import { createFakeVorkApi } from "@/test/fake-vork-api";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn()
}));

function renderPage() {
  const api = createFakeVorkApi();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  render(
    <QueryClientProvider client={client}>
      <VorkApiProvider api={api}>
        <CredentialsPage />
      </VorkApiProvider>
    </QueryClientProvider>
  );
  return api;
}

describe("CredentialsPage", () => {
  it("lists credentials and saves a masked remote credential", async () => {
    const user = userEvent.setup();
    const api = renderPage();

    expect(await screen.findByText("FakeModel（内置）")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "添加凭据" }));
    await user.type(screen.getByPlaceholderText("https://api.deepseek.com"), "https://api.deepseek.com");
    await user.type(screen.getByPlaceholderText("deepseek-v4-flash"), "deepseek-v4-flash");
    await user.type(screen.getByPlaceholderText("sk-…"), "sk-phase3-do-not-leak");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(api.request).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: "upsertCredential",
          input: expect.objectContaining({
            provider: "openai-compatible",
            apiKey: "sk-phase3-do-not-leak",
            baseUrl: "https://api.deepseek.com",
            model: "deepseek-v4-flash"
          })
        })
      );
    });
    expect(await screen.findByText(/密钥 \*\*\*\*leak/)).toBeTruthy();
    expect(screen.queryByText("sk-phase3-do-not-leak")).toBeNull();
  });
});
