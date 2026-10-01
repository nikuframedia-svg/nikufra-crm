import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { readJson, readRaw, safeRequestLogFields } from "../src/http.js";
import { HttpError } from "../src/errors.js";

describe("request body bounds", () => {
  it("rejects oversized request bodies before parsing", async () => {
    const request = Readable.from([Buffer.alloc(8 * 1024 * 1024 + 1, 65)]);
    await expect(readRaw(request as never)).rejects.toMatchObject({ status: 413, code: "payload_too_large" } satisfies Partial<HttpError>);
  });

  it("returns 400 for malformed JSON", async () => {
    const request = Readable.from(["{"]);
    await expect(readJson(request as never)).rejects.toMatchObject({ status: 400, code: "invalid_json" } satisfies Partial<HttpError>);
  });

  it("logs only the route template and never the request URL secrets", () => {
    const request = {
      method: "GET",
      url: "/api/outreach/v1/oauth/callback/google?state=private-oauth-state",
    } as never;
    const fields = safeRequestLogFields(request, "/api/outreach/v1/oauth/callback/:provider");
    expect(fields).toEqual({ method: "GET", route: "/api/outreach/v1/oauth/callback/:provider" });
    expect(JSON.stringify(fields)).not.toContain("private-oauth-state");
  });
});
