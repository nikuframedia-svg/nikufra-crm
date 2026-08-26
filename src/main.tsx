import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { AutoUpdater } from "./components/AutoUpdater";
import { AuthGate } from "./components/AuthGate";
import { CRMProvider } from "./state/crm-context";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AutoUpdater><AuthGate><CRMProvider><App /></CRMProvider></AuthGate></AutoUpdater>
    </QueryClientProvider>
  </React.StrictMode>,
);
