import { lazy, Suspense } from "react";
import { createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { AppShell } from "./components/AppShell";

const OverviewPage = lazy(() => import("./pages/OverviewPage").then((module) => ({ default: module.OverviewPage })));
const SuggestionsPage = lazy(() => import("./pages/SuggestionsPage").then((module) => ({ default: module.SuggestionsPage })));
const PipelinePage = lazy(() => import("./pages/PipelinePage").then((module) => ({ default: module.PipelinePage })));
const LeadsPage = lazy(() => import("./pages/LeadsPage").then((module) => ({ default: module.LeadsPage })));
const EmailPage = lazy(() => import("./pages/EmailPage").then((module) => ({ default: module.EmailPage })));
const ChatPage = lazy(() => import("./pages/ChatPage").then((module) => ({ default: module.ChatPage })));
const CalendarPage = lazy(() => import("./pages/CalendarPage").then((module) => ({ default: module.CalendarPage })));
const MetricsPage = lazy(() => import("./pages/MetricsPage").then((module) => ({ default: module.MetricsPage })));
const RevenuePage = lazy(() => import("./pages/RevenuePage").then((module) => ({ default: module.RevenuePage })));
const TeamPage = lazy(() => import("./pages/TeamPage").then((module) => ({ default: module.TeamPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then((module) => ({ default: module.SettingsPage })));
const CompanyPage = lazy(() => import("./pages/CompanyPage").then((module) => ({ default: module.CompanyPage })));
const OutreachLayout = lazy(() => import("./features/outreach/components").then((module) => ({ default: module.OutreachLayout })));
const OutreachOverviewPage = lazy(() => import("./features/outreach/pages/OverviewPage").then((module) => ({ default: module.OutreachOverviewPage })));
const OutreachCampaignsPage = lazy(() => import("./features/outreach/pages/CampaignsPage").then((module) => ({ default: module.OutreachCampaignsPage })));
const OutreachCampaignDetailPage = lazy(() => import("./features/outreach/pages/CampaignDetailPage").then((module) => ({ default: module.OutreachCampaignDetailPage })));
const OutreachRepliesPage = lazy(() => import("./features/outreach/pages/RepliesPage").then((module) => ({ default: module.OutreachRepliesPage })));
const OutreachAudiencesPage = lazy(() => import("./features/outreach/pages/AudiencesPage").then((module) => ({ default: module.OutreachAudiencesPage })));
const OutreachMailboxesPage = lazy(() => import("./features/outreach/pages/MailboxesPage").then((module) => ({ default: module.OutreachMailboxesPage })));
const OutreachDeliverabilityPage = lazy(() => import("./features/outreach/pages/DeliverabilityPage").then((module) => ({ default: module.OutreachDeliverabilityPage })));
const OutreachSettingsPage = lazy(() => import("./features/outreach/pages/SettingsPage").then((module) => ({ default: module.OutreachSettingsPage })));

const rootRoute = createRootRoute({ component: AppShell });
const outreachRoute = createRoute({ getParentRoute: () => rootRoute, path: "/outreach", component: OutreachLayout });
const outreachRoutes = [
  createRoute({ getParentRoute: () => outreachRoute, path: "/", component: OutreachOverviewPage }),
  createRoute({ getParentRoute: () => outreachRoute, path: "/campanhas", component: OutreachCampaignsPage }),
  createRoute({ getParentRoute: () => outreachRoute, path: "/campanhas/$campaignId", component: OutreachCampaignDetailPage }),
  createRoute({ getParentRoute: () => outreachRoute, path: "/respostas", component: OutreachRepliesPage }),
  createRoute({ getParentRoute: () => outreachRoute, path: "/audiencias", component: OutreachAudiencesPage }),
  createRoute({ getParentRoute: () => outreachRoute, path: "/mailboxes", component: OutreachMailboxesPage }),
  createRoute({ getParentRoute: () => outreachRoute, path: "/deliverability", component: OutreachDeliverabilityPage }),
  createRoute({ getParentRoute: () => outreachRoute, path: "/definicoes", component: OutreachSettingsPage }),
];
const routes = [
  createRoute({ getParentRoute: () => rootRoute, path: "/", component: OverviewPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/sugestoes", component: SuggestionsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/pipeline", component: PipelinePage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/leads", component: LeadsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/email", component: EmailPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/chat", component: ChatPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/calendario", component: CalendarPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/metricas", component: MetricsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/faturacao", component: RevenuePage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/equipa", component: TeamPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/definicoes", component: SettingsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/empresas/$companyId", component: CompanyPage }),
  outreachRoute.addChildren(outreachRoutes),
];

const routeTree = rootRoute.addChildren(routes);
const router = createRouter({ routeTree, defaultPreload: "intent" });

declare module "@tanstack/react-router" {
  interface Register { router: typeof router }
}

export function App() {
  return <Suspense fallback={<div className="route-loading"><span /><p>A preparar a vista…</p></div>}><RouterProvider router={router} /></Suspense>;
}
