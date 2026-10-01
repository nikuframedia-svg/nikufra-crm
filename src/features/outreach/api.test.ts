import { afterEach, describe, expect, it, vi } from "vitest";
import { asCollection, OutreachApiError, outreachRequest } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("Outreach API client", () => {
  it("unwraps the API envelope and normalizes database keys", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { send_mode: "disabled", next_jobs: [{ due_at: "2026-10-01T09:00:00Z" }] } }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await outreachRequest<{ sendMode: string; nextJobs: Array<{ dueAt: string }> }>("/overview");

    expect(result).toEqual({ sendMode: "disabled", nextJobs: [{ dueAt: "2026-10-01T09:00:00Z" }] });
    expect(fetchMock).toHaveBeenCalledWith("/api/outreach/v1/overview", expect.objectContaining({ credentials: "same-origin" }));
  });

  it("keeps list consumers stable for arrays and paginated responses", () => {
    expect(asCollection([{ id: "one" }])).toEqual({ items: [{ id: "one" }] });
    expect(asCollection({ items: [{ id: "two" }], page: { total: 1 } })).toEqual({ items: [{ id: "two" }], page: { total: 1 } });
    expect(asCollection(null)).toEqual({ items: [] });
  });

  it("preserves the server code and request id on failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "forbidden", message: "Sem permissão.", requestId: "req-1" } }), { status: 403, headers: { "Content-Type": "application/json" } })));

    const error = await outreachRequest("/campaigns").catch((value) => value);

    expect(error).toBeInstanceOf(OutreachApiError);
    expect(error).toMatchObject({ message: "Sem permissão.", status: 403, code: "forbidden", requestId: "req-1" });
  });

  it("contains an offline failure inside the Outreach client", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network down")));

    await expect(outreachRequest("/overview")).rejects.toMatchObject({ status: 0, code: "service_unavailable" });
  });
});
