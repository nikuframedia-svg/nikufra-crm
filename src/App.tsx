import { lazy, Suspense } from "react";
import { createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { AppShell } from "./components/AppShell";

const OverviewPage = lazy(() => import("./pages/OverviewPage").then((module) => ({ default: module.OverviewPage })));
const PipelinePage = lazy(() => import("./pages/PipelinePage").then((module) => ({ default: module.PipelinePage })));
const LeadsPage = lazy(() => import("./pages/LeadsPage").then((module) => ({ default: module.LeadsPage })));
const EmailPage = lazy(() => import("./pages/EmailPage").then((module) => ({ default: module.EmailPage })));
const MetricsPage = lazy(() => import("./pages/MetricsPage").then((module) => ({ default: module.MetricsPage })));
const RevenuePage = lazy(() => import("./pages/RevenuePage").then((module) => ({ default: module.RevenuePage })));
const TeamPage = lazy(() => import("./pages/TeamPage").then((module) => ({ default: module.TeamPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then((module) => ({ default: module.SettingsPage })));

const rootRoute = createRootRoute({ component: AppShell });
const routes = [
  createRoute({ getParentRoute: () => rootRoute, path: "/", component: OverviewPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/pipeline", component: PipelinePage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/leads", component: LeadsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/email", component: EmailPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/metricas", component: MetricsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/faturacao", component: RevenuePage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/equipa", component: TeamPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/definicoes", component: SettingsPage }),
];

const routeTree = rootRoute.addChildren(routes);
const router = createRouter({ routeTree, defaultPreload: "intent" });

declare module "@tanstack/react-router" {
  interface Register { router: typeof router }
}

export function App() {
  return <Suspense fallback={<div className="route-loading"><span /><p>A preparar a vista…</p></div>}><RouterProvider router={router} /></Suspense>;
}
