import type { DownloadEvent } from "@tauri-apps/plugin-updater";

export type UpdateProgress = {
  downloadedBytes: number;
  totalBytes: number | null;
  finished: boolean;
};

export type AvailableAppUpdate = {
  currentVersion: string;
  version: string;
  date: string | null;
  notes: string | null;
  install(onProgress?: (progress: UpdateProgress) => void): Promise<void>;
  dispose(): Promise<void>;
};

export function isDesktopApp() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function checkForAppUpdate(): Promise<AvailableAppUpdate | null> {
  if (!isDesktopApp()) return null;

  const [{ check }, { relaunch }] = await Promise.all([
    import("@tauri-apps/plugin-updater"),
    import("@tauri-apps/plugin-process"),
  ]);
  const update = await check({ timeout: 15_000 });
  if (!update) return null;

  return {
    currentVersion: update.currentVersion,
    version: update.version,
    date: update.date ?? null,
    notes: update.body ?? null,
    async install(onProgress) {
      let downloadedBytes = 0;
      let totalBytes: number | null = null;
      const report = (event: DownloadEvent) => {
        if (event.event === "Started") totalBytes = event.data.contentLength ?? null;
        if (event.event === "Progress") downloadedBytes += event.data.chunkLength;
        onProgress?.({ downloadedBytes, totalBytes, finished: event.event === "Finished" });
      };
      await update.downloadAndInstall(report, { timeout: 120_000 });
      await relaunch();
    },
    async dispose() {
      await update.close();
    },
  };
}
