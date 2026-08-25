import { afterEach, describe, expect, it, vi } from "vitest";
import { checkForAppUpdate, isDesktopApp } from "./app-updater";

const updater = vi.hoisted(() => ({ check: vi.fn() }));
const process = vi.hoisted(() => ({ relaunch: vi.fn() }));

vi.mock("@tauri-apps/plugin-updater", () => updater);
vi.mock("@tauri-apps/plugin-process", () => process);

function setDesktopRuntime(enabled: boolean) {
  if (enabled) {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} },
    });
    return;
  }
  Reflect.deleteProperty(globalThis, "window");
}

afterEach(() => {
  setDesktopRuntime(false);
  vi.clearAllMocks();
});

describe("desktop updater boundary", () => {
  it("does not contact the updater from tests or the web fallback", async () => {
    expect(isDesktopApp()).toBe(false);
    await expect(checkForAppUpdate()).resolves.toBeNull();
    expect(updater.check).not.toHaveBeenCalled();
  });

  it("returns null when the signed channel has no newer version", async () => {
    setDesktopRuntime(true);
    updater.check.mockResolvedValue(null);

    await expect(checkForAppUpdate()).resolves.toBeNull();
    expect(updater.check).toHaveBeenCalledWith({ timeout: 15_000 });
  });

  it("maps metadata and installs with byte-accurate progress before relaunch", async () => {
    setDesktopRuntime(true);
    const downloadAndInstall = vi.fn(async (onEvent: (event: unknown) => void) => {
      onEvent({ event: "Started", data: { contentLength: 12 } });
      onEvent({ event: "Progress", data: { chunkLength: 5 } });
      onEvent({ event: "Progress", data: { chunkLength: 7 } });
      onEvent({ event: "Finished" });
    });
    const close = vi.fn();
    updater.check.mockResolvedValue({
      currentVersion: "0.1.0",
      version: "0.2.0",
      date: "2026-08-25T18:00:00Z",
      body: "Melhorias de segurança.",
      downloadAndInstall,
      close,
    });

    const available = await checkForAppUpdate();
    expect(available).toMatchObject({
      currentVersion: "0.1.0",
      version: "0.2.0",
      date: "2026-08-25T18:00:00Z",
      notes: "Melhorias de segurança.",
    });

    const progress = vi.fn();
    await available?.install(progress);
    expect(downloadAndInstall).toHaveBeenCalledWith(expect.any(Function), { timeout: 120_000 });
    expect(progress.mock.calls.map(([value]) => value)).toEqual([
      { downloadedBytes: 0, totalBytes: 12, finished: false },
      { downloadedBytes: 5, totalBytes: 12, finished: false },
      { downloadedBytes: 12, totalBytes: 12, finished: false },
      { downloadedBytes: 12, totalBytes: 12, finished: true },
    ]);
    expect(process.relaunch).toHaveBeenCalledOnce();

    await available?.dispose();
    expect(close).toHaveBeenCalledOnce();
  });
});
