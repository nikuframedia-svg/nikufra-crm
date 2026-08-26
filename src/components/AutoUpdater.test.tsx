// @vitest-environment jsdom

import React from "react";
import "@testing-library/jest-dom/vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AvailableAppUpdate } from "../lib/app-updater";
import { AutoUpdater } from "./AutoUpdater";

const updater = vi.hoisted(() => ({ checkForAppUpdate: vi.fn() }));
vi.mock("../lib/app-updater", () => updater);

afterEach(() => {
  vi.clearAllMocks();
});

describe("AutoUpdater", () => {
  it("checks once in StrictMode and blocks interaction while a signed update installs", async () => {
    let finishInstall: (() => void) | undefined;
    const install = vi.fn(async (onProgress?: Parameters<AvailableAppUpdate["install"]>[0]) => {
      onProgress?.({ downloadedBytes: 5, totalBytes: 10, finished: false });
      await new Promise<void>((resolve) => { finishInstall = resolve; });
    });
    updater.checkForAppUpdate.mockResolvedValue({
      currentVersion: "0.1.2",
      version: "0.1.3",
      date: null,
      notes: null,
      install,
      dispose: vi.fn(),
    } satisfies AvailableAppUpdate);

    render(<React.StrictMode><AutoUpdater><main>CRM carregado</main></AutoUpdater></React.StrictMode>);

    expect(screen.getByText("CRM carregado")).toBeInTheDocument();
    expect(await screen.findByRole("status", { name: "Atualização da aplicação em curso" })).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    await waitFor(() => {
      expect(updater.checkForAppUpdate).toHaveBeenCalledOnce();
      expect(install).toHaveBeenCalledOnce();
    });

    await act(async () => finishInstall?.());
    expect(screen.getByText("A reiniciar a aplicação")).toBeInTheDocument();
  });
});
