import { useEffect, useMemo, useState } from "react";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import {
  BarChart3,
  Bell,
  Building2,
  ChevronDown,
  CircleDollarSign,
  Command,
  FilePenLine,
  KanbanSquare,
  LayoutDashboard,
  Mail,
  Menu,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  Users,
} from "lucide-react";
import { useCRM } from "../state/crm-context";
import { supabase } from "../lib/supabase";
import { Wordmark } from "./Logo";
import { Button, Modal, StageChip } from "./ui";

const navItems = [
  { to: "/", label: "Visão geral", icon: LayoutDashboard },
  { to: "/pipeline", label: "Pipeline", icon: KanbanSquare },
  { to: "/leads", label: "Empresas e leads", icon: Building2 },
  { to: "/email", label: "Email", icon: Mail },
  { to: "/metricas", label: "Métricas", icon: BarChart3 },
  { to: "/faturacao", label: "Faturação", icon: CircleDollarSign },
  { to: "/equipa", label: "Equipa", icon: Users },
];

export function AppShell() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { leads, opportunities, addActivity, team, dataMode, currentUserId } = useCRM();
  const [collapsed, setCollapsed] = useState(false);
  const [dark, setDark] = useState(true);
  const [commandOpen, setCommandOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    document.documentElement.classList.toggle("light", !dark);
  }, [dark]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }
      if (event.key.toLowerCase() === "e" && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) setActivityOpen(true);
      if (event.key === "Escape") { setCommandOpen(false); setActivityOpen(false); }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  const searchResults = useMemo(() => {
    const normalized = query.toLowerCase().trim();
    if (!normalized) return [];
    return leads.filter((lead) => `${lead.nome} ${lead.empresa} ${lead.email}`.toLowerCase().includes(normalized)).slice(0, 6);
  }, [leads, query]);

  const activeLabel = pathname.startsWith("/empresas/") ? "Ficha de empresa" : navItems.find((item) => item.to === pathname)?.label ?? "Definições";
  const currentUser = team.find((owner) => owner.id === currentUserId) ?? team[0];

  function handleNewActivity(formData: FormData) {
    const opportunityId = String(formData.get("opportunityId"));
    const opportunity = opportunities.find((item) => item.id === opportunityId) ?? opportunities[0];
    addActivity({
      id: crypto.randomUUID(),
      oportunidadeId: opportunity.id,
      empresa: opportunity.empresa,
      userId: currentUser?.id ?? currentUserId,
      tipo: String(formData.get("tipo")) as "email" | "chamada" | "reuniao" | "proposta" | "nota",
      descricao: String(formData.get("descricao")),
      data: String(formData.get("data") || new Date().toISOString()),
    });
    setActivityOpen(false);
  }

  return (
    <div className={`app-shell ${collapsed ? "app-shell--collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar__brand"><Wordmark compact={collapsed} /><button className="icon-button" onClick={() => setCollapsed((value) => !value)} aria-label="Alternar barra lateral"><Menu size={17} /></button></div>
        <button className="global-search" onClick={() => setCommandOpen(true)}><Search size={16} /><span>Pesquisar...</span><kbd>⌘K</kbd></button>
        <nav aria-label="Navegação principal">
          <p className="nav-label">Trabalho</p>
          {navItems.map((item) => {
            const Icon = item.icon;
            return <Link key={item.to} to={item.to} className="nav-item" activeProps={{ className: "nav-item nav-item--active" }}><Icon size={17} /><span>{item.label}</span></Link>;
          })}
          <p className="nav-label nav-label--second">Sistema</p>
          <Link to="/definicoes" className="nav-item" activeProps={{ className: "nav-item nav-item--active" }}><Settings size={17} /><span>Definições</span></Link>
        </nav>
        <div className="sidebar__footer">
          <button className="user-card" onClick={() => { if (supabase) void supabase.auth.signOut(); }} title={supabase ? "Terminar sessão" : "Dataset local"}><span className="avatar avatar--md" style={{ "--avatar": currentUser?.cor ?? "#3b82f6" } as React.CSSProperties}>{currentUser?.iniciais ?? "N"}</span><span><strong>{currentUser?.nome ?? "Nikufra"}</strong><small>{supabase ? "Terminar sessão" : "Dados reais locais"}</small></span><ChevronDown size={15} /></button>
        </div>
      </aside>
      <div className="workspace">
        <div className="titlebar" data-tauri-drag-region>
          <div><span className="status-dot" />{activeLabel}<small>{dataMode === "supabase" ? "Sincronizado com servidor" : "Dataset Nikufra real · local"}</small></div>
          <div className="titlebar__actions">
            <button className="icon-button" onClick={() => setDark((value) => !value)} aria-label="Alternar tema">{dark ? <Sun size={17} /> : <Moon size={17} />}</button>
            <button className="icon-button" aria-label="Notificações"><Bell size={17} /></button>
            <Button onClick={() => setActivityOpen(true)}><Plus size={16} />Registar atividade <kbd>E</kbd></Button>
          </div>
        </div>
        <main><Outlet /></main>
      </div>

      <Modal open={commandOpen} onClose={() => setCommandOpen(false)} title="Pesquisa global" description="Empresas, contactos e oportunidades." width="680px">
        <div className="command-input"><Search size={19} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Escreve para pesquisar..." /></div>
        <div className="command-results">
          {!query ? <div className="command-hint"><Command size={18} /><span>Pesquisa por nome, empresa ou email. Usa as setas para navegar.</span></div> : null}
          {query && searchResults.length === 0 ? <div className="empty-state">Sem resultados. Confirma o nome ou email.</div> : null}
          {searchResults.map((lead) => <button key={lead.id} onClick={() => setCommandOpen(false)}><span className="company-monogram">{lead.empresa.slice(0, 2).toUpperCase()}</span><span><strong>{lead.empresa}</strong><small>{lead.nome} · {lead.email}</small></span><StageChip stage={lead.estado} /></button>)}
        </div>
      </Modal>

      <Modal open={activityOpen} onClose={() => setActivityOpen(false)} title="Registar atividade" description="Objetivo: menos de 15 segundos após o contacto.">
        <form onSubmit={(event) => { event.preventDefault(); handleNewActivity(new FormData(event.currentTarget)); }} className="form-stack">
          <label>Oportunidade<select name="opportunityId">{opportunities.map((item) => <option key={item.id} value={item.id}>{item.empresa} — {item.titulo}</option>)}</select></label>
          <div className="form-grid"><label>Tipo<select name="tipo"><option value="chamada">Chamada</option><option value="reuniao">Reunião</option><option value="email">Email</option><option value="proposta">Proposta</option><option value="nota">Nota</option></select></label><label>Data<input name="data" type="datetime-local" defaultValue={new Date().toISOString().slice(0, 16)} /></label></div>
          <label>Resumo<textarea name="descricao" required autoFocus placeholder="O que aconteceu e qual é o próximo passo?" rows={4} /></label>
          <div className="modal__actions"><Button type="button" variant="secondary" onClick={() => setActivityOpen(false)}>Cancelar</Button><Button type="submit"><FilePenLine size={16} />Guardar atividade</Button></div>
        </form>
      </Modal>
    </div>
  );
}
