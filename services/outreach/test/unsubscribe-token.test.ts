import { describe, expect, it } from "vitest";
import { unsubscribeToken } from "../src/delivery.js";

describe("unsubscribe delivery tokens", () => {
  it("is stable for a retry of the same job but unique across deliveries", () => {
    const recipient = "10000000-0000-4000-8000-000000000001";
    const first = unsubscribeToken(recipient, "20000000-0000-4000-8000-000000000001");
    expect(unsubscribeToken(recipient, "20000000-0000-4000-8000-000000000001")).toBe(first);
    expect(unsubscribeToken(recipient, "20000000-0000-4000-8000-000000000002")).not.toBe(first);
  });
});
