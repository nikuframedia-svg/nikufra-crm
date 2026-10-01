import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Gauge,
  Inbox,
  ListFilter,
  MailCheck,
  Megaphone,
  RefreshCw,
  Settings2,
  ShieldCheck,
  UsersRound,
  XCircle,
} from "lucide-react";
import { Button } from "../../components/ui";
import { useCRM } from "../../state/crm-context";
import { adminOutreachCapabilities, canAccessOutreachPath, canSeeOutreachNavigation, hasOutreachCapability } from "./access";
import { useSettings } from "./hooks";
import type { CampaignStatus, Mailbox, OutreachCapability, OutreachRole, PageInfo } from "./types";

const navItems = [
  { to: "/outreach", label: "Resumo", icon: BarChart3, exact: true, capability: "outreach.read" },
  { to: "/outreach/campanhas", label: "Campanhas", icon: Megaphone, capability: "outreach.read" },
  { to: "/outreach/respostas", label: "Respostas", icon: Inbox, capability: "outreach.thread.handle" },
  { to: "/outreach/audiencias", label: "Audiências", icon: UsersRound, capability: "outreach.campaign.manage" },
  { to: "/outreach/mailboxes", label: "Mailboxes", icon: MailCheck, capability: "outreach.mailbox.manage" },
  { to: "/outreach/deliverability", label: "Deliverability", icon: Gauge, capability: "outreach.read" },
  { to: "/outreach/definicoes", label: "Definições", icon: Settings2, capability: "outreach.admin" },
] as const;

interface OutreachAccessValue {
  role: OutreachRole;
  capabilities: OutreachCapability[];
  can: (capability: OutreachCapability) => boolean;
}

const OutreachAccessContext = createContext<OutreachAccessValue>({
  role: "viewer",
  capabilities: ["outreach.read"],
  can: (capability) => capability === "outreach.read",
});

export function useOutreachAccess() {
  return useContext(OutreachAccessContext);
}

export function OutreachLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { team, currentUserId, dataMode } = useCRM();
  const currentUser = team.find((member) => member.id === currentUserId) ?? (dataMode === "local" ? team[0] : undefined);
  const settings = useSettings(Boolean(currentUser));
  const adminOnly = settings.data?.adminOnly ?? (import.meta.env.VITE_OUTREACH_ADMIN_ONLY !== "false");
  const fallbackCapabilities: OutreachCapability[] = currentUser?.role === "admin" ? adminOutreachCapabilities : ["outreach.read"];
  const capabilities = settings.data?.capabilities?.length ? settings.data.capabilities : fallbackCapabilities;
  const access = useMemo<OutreachAccessValue>(() => ({
    role: settings.data?.role ?? (currentUser?.role === "admin" ? "admin" : "viewer"),
    capabilities,
    can: (capability) => hasOutreachCapability(capabilities, capability),
  }), [capabilities, currentUser?.role, settings.data?.role]);
  if (dataMode === "supabase" && !currentUser) return <div className="outreach-module"><OutreachLoading label="A confirmar permissões Outreach…" /></div>;
  if (dataMode === "supabase" && settings.isPending) return <div className="outreach-module"><OutreachLoading label="A confirmar permissões Outreach…" /></div>;
  if (!canSeeOutreachNavigation(adminOnly, currentUser?.role)) return <div className="outreach-module"><section className="outreach-access-denied"><span><ShieldCheck size={22} /></span><p className="outreach-kicker">Dark deploy</p><h1>Outreach ainda não está disponível para esta conta</h1><p>O módulo está limitado a administradores durante a validação inicial. Pipeline, Empresas, Email e o restante CRM continuam operacionais.</p></section></div>;
  const routeAllowed = canAccessOutreachPath(pathname, capabilities);
  return (
    <OutreachAccessContext.Provider value={access}><section className="outreach-module">
      <header className="outreach-module__masthead">
        <div>
          <p className="outreach-kicker">Nikufra Outreach</p>
          <h1>Prospecção com contexto do CRM</h1>
          <p>Campanhas, respostas e reputação sobre a mesma base de contactos — sem duplicar identidades.</p>
        </div>
        <span className="outreach-safe-state"><span />Envio protegido por guardrails</span>
      </header>
      <nav className="outreach-tabs" aria-label="Navegação de Outreach">
        {navItems.filter((item) => access.can(item.capability)).map((item) => {
          const { to, label, icon: Icon } = item;
          const active = "exact" in item && item.exact ? pathname === to : pathname.startsWith(to);
          return <Link key={to} to={to} className={`outreach-tab ${active ? "is-active" : ""}`} aria-current={active ? "page" : undefined}><Icon size={15} /><span>{label}</span></Link>;
        })}
      </nav>
      <div className="outreach-module__body">{routeAllowed ? <Outlet /> : <section className="outreach-access-denied"><span><ShieldCheck size={22} /></span><p className="outreach-kicker">Acesso limitado</p><h1>Esta área não faz parte do teu papel Outreach</h1><p>As opções apresentadas no módulo seguem as capacidades da tua conta. Pede a um administrador para alterar o papel se precisares desta área.</p></section>}</div>
    </section></OutreachAccessContext.Provider>
  );
}

export function OutreachPageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return <header className="outreach-page-header"><div><p className="outreach-kicker">{eyebrow}</p><h2>{title}</h2><p>{description}</p></div>{actions ? <div className="outreach-page-actions">{actions}</div> : null}</header>;
}

export function OutreachLoading({ label = "A carregar dados Outreach…" }: { label?: string }) {
  return <div className="outreach-loading" role="status"><span /><p>{label}</p></div>;
}

export function OutreachError({ error, retry }: { error: unknown; retry?: () => void }) {
  const message = error instanceof Error ? error.message : "O serviço Outreach não respondeu.";
  return (
    <section className="outreach-error" role="alert">
      <span><AlertTriangle size={21} /></span>
      <div><strong>Outreach está temporariamente indisponível</strong><p>{message}</p><small>Pipeline, Empresas, Email e as restantes áreas do CRM continuam disponíveis.</small></div>
      {retry ? <Button variant="secondary" onClick={retry}><RefreshCw size={15} />Tentar novamente</Button> : null}
    </section>
  );
}

export function EmptyPanel({ icon, title, description, action }: { icon?: ReactNode; title: string; description: string; action?: ReactNode }) {
  return <section className="outreach-empty">{icon ? <span>{icon}</span> : null}<h3>{title}</h3><p>{description}</p>{action}</section>;
}

export function MetricTile({ label, value, detail, icon }: { label: string; value: string; detail: string; icon: ReactNode }) {
  return <article className="outreach-metric"><header><span>{label}</span><i>{icon}</i></header><strong>{value}</strong><p>{detail}</p></article>;
}

const campaignLabels: Record<CampaignStatus, string> = { draft: "Rascunho", running: "Ativa", paused: "Em pausa", completed: "Concluída", archived: "Arquivada" };

export function CampaignBadge({ status }: { status: CampaignStatus }) {
  return <span className={`outreach-badge outreach-badge--${status}`}><span />{campaignLabels[status] ?? status}</span>;
}

export function MailboxBadge({ status }: { status: Mailbox["status"] }) {
  const labels = { ready: "Pronta", attention: "Atenção", paused: "Pausada", disconnected: "Desligada" };
  return <span className={`outreach-badge outreach-badge--${status}`}><span />{labels[status]}</span>;
}

export function EligibilityBadge({ eligible, reasons }: { eligible: boolean; reasons?: string[] }) {
  return eligible
    ? <span className="outreach-eligibility is-eligible"><CheckCircle2 size={13} />Elegível</span>
    : <span className="outreach-eligibility is-blocked" title={reasons?.join(" · ")}><XCircle size={13} />{reasons?.[0] ?? "Inelegível"}</span>;
}

export function ProgressBar({ value, label }: { value: number; label: string }) {
  const normalized = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return <span className="outreach-progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(normalized)}><i style={{ width: `${normalized}%` }} /></span>;
}

export function SearchField({ value, onChange, placeholder, label = "Pesquisar" }: { value: string; onChange: (value: string) => void; placeholder: string; label?: string }) {
  return <label className="outreach-search"><ListFilter size={15} /><span className="sr-only">{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></label>;
}

export function OutreachPagination({ page, onPageChange }: { page?: PageInfo; onPageChange: (page: number) => void }) {
  const current = page?.page ?? 1;
  const total = page?.total ?? 0;
  const pageSize = Math.max(1, page?.pageSize ?? 25);
  const pages = Math.ceil(total / pageSize);
  if (pages <= 1) return null;
  return <nav className="outreach-pagination" aria-label="Páginas de Outreach">
    <Button type="button" variant="secondary" disabled={current <= 1} onClick={() => onPageChange(current - 1)}>Anterior</Button>
    <span aria-live="polite">Página {current} de {pages} · {formatNumber(total)} resultados</span>
    <Button type="button" variant="secondary" disabled={current >= pages} onClick={() => onPageChange(current + 1)}>Seguinte</Button>
  </nav>;
}

export function useDialogFocus(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || !ref.current) return;
    const node = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    const focusable = Array.from(node.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
    focusable[0]?.focus();
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab" || focusable.length === 0) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    node.addEventListener("keydown", handleKey);
    return () => { node.removeEventListener("keydown", handleKey); previous?.focus(); };
  }, [onClose, open]);
  return ref;
}

export function ModuleDialog({ open, title, description, onClose, children }: { open: boolean; title: string; description: string; onClose: () => void; children: ReactNode }) {
  const ref = useDialogFocus(open, onClose);
  if (!open) return null;
  return <div className="outreach-dialog-backdrop" onMouseDown={(event) => event.currentTarget === event.target && onClose()}><div ref={ref} className="outreach-dialog" role="dialog" aria-modal="true" aria-labelledby="outreach-dialog-title"><header><div><p className="outreach-kicker">Nikufra Outreach</p><h2 id="outreach-dialog-title">{title}</h2><p>{description}</p></div><button className="outreach-icon-button" onClick={onClose} aria-label="Fechar"><XCircle size={18} /></button></header>{children}</div></div>;
}

export function formatNumber(value: number) { return new Intl.NumberFormat("pt-PT", { maximumFractionDigits: 1 }).format(value || 0); }
export function formatPercent(value: number) { return new Intl.NumberFormat("pt-PT", { style: "percent", maximumFractionDigits: 1 }).format((value || 0) / 100); }
export function formatDateTime(value?: string | null) { if (!value) return "—"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("pt-PT", { dateStyle: "medium", timeStyle: "short" }).format(date); }
