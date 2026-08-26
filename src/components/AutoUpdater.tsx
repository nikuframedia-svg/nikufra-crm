import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { checkForAppUpdate, type AvailableAppUpdate, type UpdateProgress } from "../lib/app-updater";
import { Wordmark } from "./Logo";

type UpdateSnapshot =
  | { phase: "checking" | "current" }
  | { phase: "downloading"; version: string; progress: UpdateProgress }
  | { phase: "restarting"; version: string }
  | { phase: "error"; message: string };

const listeners = new Set<(snapshot: UpdateSnapshot) => void>();
let snapshot: UpdateSnapshot = { phase: "checking" };
let updateTask: Promise<void> | null = null;

function publish(nextSnapshot: UpdateSnapshot) {
  snapshot = nextSnapshot;
  listeners.forEach((listener) => listener(snapshot));
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Não foi possível instalar a atualização.";
}

async function disposeQuietly(update: AvailableAppUpdate | null) {
  if (!update) return;
  try {
    await update.dispose();
  } catch {
    // The updater resource may already have been released after a failed install.
  }
}

function startAutomaticUpdate() {
  if (updateTask) return updateTask;

  updateTask = (async () => {
    let update: AvailableAppUpdate | null = null;
    try {
      publish({ phase: "checking" });
      update = await checkForAppUpdate();
      if (!update) {
        publish({ phase: "current" });
        return;
      }

      const version = update.version;
      publish({
        phase: "downloading",
        version,
        progress: { downloadedBytes: 0, totalBytes: null, finished: false },
      });
      await update.install((progress) => publish({ phase: "downloading", version, progress }));
      publish({ phase: "restarting", version });
    } catch (error) {
      await disposeQuietly(update);
      publish({ phase: "error", message: errorMessage(error) });
    }
  })();

  return updateTask;
}

function retryAutomaticUpdate() {
  updateTask = null;
  void startAutomaticUpdate();
}

export function updateProgressPercent(progress: UpdateProgress) {
  if (!progress.totalBytes || progress.totalBytes <= 0) return null;
  return Math.min(100, Math.round((progress.downloadedBytes / progress.totalBytes) * 100));
}

export function AutoUpdater({ children }: { children: ReactNode }) {
  const [update, setUpdate] = useState<UpdateSnapshot>(snapshot);
  const [dismissedError, setDismissedError] = useState(false);

  useEffect(() => {
    listeners.add(setUpdate);
    setUpdate(snapshot);
    void startAutomaticUpdate();
    return () => { listeners.delete(setUpdate); };
  }, []);

  const isInstalling = update.phase === "downloading" || update.phase === "restarting";
  const percent = update.phase === "downloading" ? updateProgressPercent(update.progress) : 100;

  return (
    <>
      {children}

      {isInstalling ? (
        <div className="update-overlay" role="status" aria-live="polite" aria-label="Atualização da aplicação em curso">
          <section className="update-panel">
            <Wordmark />
            <p className="eyebrow">Atualização segura</p>
            <h1>{update.phase === "restarting" ? "A reiniciar a aplicação" : "A instalar a nova versão"}</h1>
            <p>
              Versão <span className="mono">{update.version}</span>. A sessão e os dados do CRM ficam preservados.
            </p>
            <div className="update-progress" aria-hidden="true">
              <span style={{ width: `${percent ?? 24}%` }} className={percent === null ? "is-indeterminate" : ""} />
            </div>
            <small className="mono">
              {update.phase === "restarting" ? "INSTALAÇÃO CONCLUÍDA" : percent === null ? "A TRANSFERIR…" : `${percent}%`}
            </small>
          </section>
        </div>
      ) : null}

      {update.phase === "error" && !dismissedError ? (
        <aside className="update-error" role="alert">
          <AlertTriangle size={17} aria-hidden="true" />
          <div>
            <strong>Atualização por concluir</strong>
            <span>{update.message}</span>
          </div>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => {
              setDismissedError(false);
              retryAutomaticUpdate();
            }}
          >
            <RefreshCw size={13} aria-hidden="true" /> Tentar novamente
          </button>
          <button type="button" className="update-error__dismiss" onClick={() => setDismissedError(true)} aria-label="Fechar aviso">×</button>
        </aside>
      ) : null}
    </>
  );
}
