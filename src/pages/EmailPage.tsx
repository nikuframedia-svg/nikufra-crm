import { useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-shell";
import { Archive, CheckCircle2, ChevronRight, Clock3, ExternalLink, FilePenLine, Inbox, MailCheck, Plus, Search, Send, Sparkles, Users } from "lucide-react";
import { useCRM } from "../state/crm-context";
import { supabase } from "../lib/supabase";
import type { Draft } from "../types";
import { Button, Card, PageHeader, StageChip } from "../components/ui";

const templates = [
  { name: "Primeiro contacto industrial", subject: "{{empresa}} × Nikufra — uma hipótese concreta", body: "Olá {{nome}},\n\nTenho acompanhado o trabalho da {{empresa}} em {{vertical}}. Na Nikufra ajudamos fabricantes a transformar dados de ERP, MES e chão de fábrica em decisões operacionais mais rápidas.\n\nFaz sentido uma conversa de 20 minutos para perceber se existe um caso concreto?\n\nCumprimentos,\nJoão" },
  { name: "Follow-up de reunião", subject: "Próximos passos — Nikufra × {{empresa}}", body: "Olá {{nome}},\n\nObrigado pela conversa. Deixo abaixo os próximos passos que alinhámos e o contexto técnico relevante.\n\nCumprimentos,\nJoão" },
  { name: "Reativação", subject: "Retomar o tema de dados na {{empresa}}", body: "Olá {{nome}},\n\nRetomo o nosso contacto porque o contexto que discutimos pode ter mudado. Há disponibilidade para revermos o tema este mês?\n\nCumprimentos,\nJoão" },
];

const threads = [
  { company: "Ferrovia Norte", person: "Rui Correia", subject: "Re: proposta revista", snippet: "Obrigado João. A equipa de operações já reviu a fase inicial...", time: "09:42", unread: true },
  { company: "Alumitech", person: "Ana Faria", subject: "Dados do piloto — semana 4", snippet: "Segue o export das duas linhas e a atualização do mapeamento...", time: "Ontem", unread: true },
  { company: "CarbonForm", person: "Mónica Santos", subject: "Re: reunião de descoberta", snippet: "Perfeito, quinta às 11h funciona para toda a equipa.", time: "Ontem", unread: false },
  { company: "Circuita", person: "Laura Viana", subject: "Documentação MES", snippet: "Conseguimos disponibilizar a especificação via VPN interna.", time: "22 ago", unread: false },
];

export function EmailPage() {
  const { leads, drafts, addDrafts, activities, dataMode, team, currentUserId, emailSelection, setEmailSelection } = useCRM();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(emailSelection));
  const [templateIndex, setTemplateIndex] = useState(0);
  const [subject, setSubject] = useState(templates[0].subject);
  const [body, setBody] = useState(templates[0].body);
  const [sent, setSent] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const eligible = useMemo(() => leads.filter((lead) => !lead.optout && Boolean(lead.email) && `${lead.nome} ${lead.empresa}`.toLowerCase().includes(search.toLowerCase())), [leads, search]);
  const visibleThreads = dataMode === "supabase" ? activities.filter((activity) => activity.tipo === "email").slice(0, 6).map((activity) => ({ company: activity.empresa, person: "Contacto", subject: activity.descricao, snippet: activity.descricao, time: new Date(activity.data).toLocaleDateString("pt-PT", { day: "2-digit", month: "short" }), unread: false })) : threads;
  const currentEmail = team.find((owner) => owner.id === currentUserId)?.email ?? team[0]?.email ?? "conta@nikufra.ai";

  function chooseTemplate(index: number) { setTemplateIndex(index); setSubject(templates[index].subject); setBody(templates[index].body); setSent(false); }
  function renderTemplate(text: string, lead: typeof leads[number]) { return text.replaceAll("{{nome}}", lead.nome.split(" ")[0]).replaceAll("{{empresa}}", lead.empresa).replaceAll("{{vertical}}", lead.vertical); }
  async function handleOpenGmail() {
    if ("__TAURI_INTERNALS__" in window) await open("https://mail.google.com/mail/u/0/#drafts");
    else window.open("https://mail.google.com/mail/u/0/#drafts", "_blank", "noopener,noreferrer");
  }
  async function handleGenerate() {
    setGenerating(true); setError(""); setSent(false);
    const selectedLeads = eligible.filter((lead) => selected.has(lead.id));
    const newDrafts: Draft[] = selectedLeads.map((lead) => ({ id: crypto.randomUUID(), destinatario: lead.email, empresa: lead.empresa, assunto: renderTemplate(subject, lead), mensagem: renderTemplate(body, lead), criadoEm: "Agora" }));
    if (supabase) {
      const { error: functionError } = await supabase.functions.invoke("gmail-drafts", { body: { drafts: selectedLeads.map((lead, index) => ({ contactoId: lead.id, destinatario: lead.email, assunto: newDrafts[index].assunto, mensagem: newDrafts[index].mensagem })) } });
      if (functionError) { setError(functionError.message); setGenerating(false); return; }
    }
    addDrafts(newDrafts); setEmailSelection([]); setSent(true); setGenerating(false);
  }

  return (
    <div className="page">
      <PageHeader eyebrow="Gmail conectado" title="Email e rascunhos" description="Lê o contexto, personaliza templates e cria rascunhos. O envio é sempre manual no Gmail." actions={<Button variant="secondary" onClick={() => void handleOpenGmail()}><ExternalLink size={16} />Abrir Gmail</Button>} />
      <div className="mail-status"><span><CheckCircle2 size={16} />{currentEmail}</span><span>Última sincronização há 4 min</span><span><Clock3 size={14} />Próxima em 11 min</span><b>gmail.readonly + gmail.compose</b></div>
      <div className="email-layout">
        <Card className="inbox-panel">
          <div className="panel-header"><div><p className="eyebrow">Caixa de entrada</p><h2>Conversas recentes</h2></div><span className="counter">2</span></div>
          <div className="inbox-list">{visibleThreads.map((thread, index) => <button key={`${thread.company}-${index}`} className={thread.unread ? "is-unread" : ""}><span className="company-monogram">{thread.company.slice(0, 2).toUpperCase()}</span><span><strong>{thread.company}<small>{thread.time}</small></strong><b>{thread.subject}</b><p>{thread.snippet}</p></span><ChevronRight size={15} /></button>)}</div>
          <button className="panel-link"><Inbox size={15} />Ver toda a caixa de entrada</button>
        </Card>

        <Card className="composer-panel">
          <div className="panel-header"><div><p className="eyebrow">Composição assistida</p><h2>Criar rascunhos</h2></div><span className="safe-label"><MailCheck size={14} />Nunca envia automaticamente</span></div>
          <div className="composer-grid">
            <section className="recipient-picker">
              <div className="section-label"><span>1</span><strong>Destinatários</strong><b>{selected.size} selecionados</b></div>
              <div className="table-search table-search--compact"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Pesquisar contactos" /></div>
              <label className="select-all"><input type="checkbox" checked={selected.size === eligible.length && eligible.length > 0} onChange={(event) => setSelected(event.target.checked ? new Set(eligible.map((lead) => lead.id)) : new Set())} />Selecionar {eligible.length} elegíveis<span>{leads.filter((lead) => lead.optout).length} opt-out excluídos</span></label>
              <div className="recipient-list">{eligible.slice(0, 9).map((lead) => <label key={lead.id}><input type="checkbox" checked={selected.has(lead.id)} onChange={(event) => setSelected((current) => { const next = new Set(current); event.target.checked ? next.add(lead.id) : next.delete(lead.id); return next; })} /><span className="company-monogram">{lead.nome.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><span><strong>{lead.nome}</strong><small>{lead.empresa}</small></span><StageChip stage={lead.estado} /></label>)}</div>
            </section>
            <section className="message-editor">
              <div className="section-label"><span>2</span><strong>Mensagem</strong><b><Sparkles size={13} />Variáveis ativas</b></div>
              <label>Template<select value={templateIndex} onChange={(event) => chooseTemplate(Number(event.target.value))}>{templates.map((template, index) => <option key={template.name} value={index}>{template.name}</option>)}</select></label>
              <label>Assunto<input value={subject} onChange={(event) => setSubject(event.target.value)} /></label>
              <label>Mensagem<textarea value={body} onChange={(event) => setBody(event.target.value)} rows={11} /></label>
              <div className="variable-row"><button>{"{{nome}}"}</button><button>{"{{empresa}}"}</button><button>{"{{vertical}}"}</button></div>
              {sent ? <div className="success-banner"><CheckCircle2 size={17} /><span><strong>{selected.size} rascunhos criados.</strong> Revê e envia cada um no Gmail.</span></div> : null}
              {error ? <div className="auth-error">{error}. Confirma a ligação Gmail nas definições.</div> : null}
              <Button className="generate-button" disabled={!selected.size || generating} onClick={handleGenerate}><FilePenLine size={16} />{generating ? "A criar rascunhos…" : `Criar ${selected.size || ""} rascunhos`}</Button>
            </section>
          </div>
        </Card>

        <Card className="drafts-panel">
          <div className="panel-header"><div><p className="eyebrow">Preparados</p><h2>Rascunhos recentes</h2></div><button className="icon-button"><Plus size={16} /></button></div>
          <div className="draft-list">{drafts.slice(0, 6).map((draft) => <button key={draft.id}><span className="draft-icon"><FilePenLine size={15} /></span><span><strong>{draft.empresa}</strong><b>{draft.assunto}</b><small>{draft.criadoEm} · {draft.destinatario}</small></span><Send size={14} /></button>)}</div>
          <div className="draft-footer"><span><Archive size={14} />{drafts.length} rascunhos</span><span><Users size={14} />Taxa de resposta 34%</span></div>
        </Card>
      </div>
    </div>
  );
}
