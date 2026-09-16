import { describe, expect, it } from "vitest";
import { buildComputerApp } from "./server.js";

describe("computer health", () => {
  it("returns ok without auth", async () => {
    const app = buildComputerApp({ token: "test-token", maxSlots: 1 });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("rejects protected routes without token", async () => {
    const app = buildComputerApp({ token: "test-token", maxSlots: 1 });
    const res = await app.inject({ method: "POST", url: "/v1/slots/acquire", payload: {} });
    expect(res.statusCode).toBe(401);
  });
});
