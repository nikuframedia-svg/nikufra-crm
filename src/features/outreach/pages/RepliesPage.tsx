import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Archive, ArrowLeft, Inbox, Mail, RefreshCw, Send, UserRound } from "lucide-react";
import { Button } from "../../../components/ui";
import { useCRM } from "../../../state/crm-context";
import { EmptyPanel, formatDateTime, OutreachError, OutreachLoading, OutreachPageHeader, OutreachPagination, SearchField, useOutreachAccess } from "../components";
import { useThread, useThreadAction, useThreads } from "../hooks";
import type { OutreachThread } from "../types";

const classificationLabels: Record<OutreachThread["classification"], string> = {
  positive: "Interessado",
  question: "Pergunta",
  objection: "Objeção",
  negative: "Sem interesse",
  auto_reply: "Resposta automática",
  unclassified: "Por classificar",
};
const emptyThreads: OutreachThread[] = [];

export function OutreachRepliesPage() {
  const { team } = useCRM();
  const access = useOutreachAccess();
  const [page, setPage] = useState(1);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia("(max-width: 680px)").matches);
  const threads = useThreads(page);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "unread" | "assigned">("all");
  const detail = useThread(selectedId);
  const action = useThreadAction(selectedId);
  const items = threads.data?.items ?? emptyThreads;
  useEffect(() => {
    const media = window.matchMedia("(max-width: 680px)");
    const update = () => setIsMobile(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (isMobile || !items.length) return;
    setSelectedId((current) => items.some((item) => item.id === current) ? current : items[0].id);
  }, [isMobile, items]);
  const filtered = useMemo(() => items.filter((thread) => {
    const text = `${thread.contactName} ${thread.contactEmail} ${thread.companyName} ${thread.subject}`.toLowerCase();
    return text.includes(query.toLowerCase().trim()) && (filter === "all" || (filter === "unread" ? thread.unread : Boolean(thread.assignedTo)));
  }), [filter, items, query]);

  if (threads.isLoading) return <OutreachLoading label="A sincronizar respostas…" />;
  if (threads.isError) return <OutreachError error={threads.error} retry={() => void threads.refetch()} />;

  async function reply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement); const body = String(form.get("body") ?? "").trim(); if (!body) return;
    try {
      await action.mutateAsync({ action: "reply", payload: { body } });
      formElement.reset();
      await detail.refetch();
    } catch { /* Keep the draft visible while the inline error explains the failure. */ }
  }

  return <div className="outreach-page outreach-page--replies">
    <OutreachPageHeader eyebrow="Inbox partilhada" title="Respostas" description="Trata respostas mantendo o threading do provider. Respostas positivas criam atividade e sugestão no CRM, sem avançar o pipeline automaticamente." actions={<Button variant="secondary" onClick={() => void threads.refetch()}><RefreshCw size={15} />Sincronizar</Button>} />
    <section className={`outreach-inbox ${selectedId ? "has-selection" : ""}`}>
      <aside className="outreach-inbox-list">
        <header><SearchField value={query} onChange={setQuery} placeholder="Nesta página: contacto, empresa ou assunto…" /><div className="outreach-segmented" role="group" aria-label="Filtrar conversas nesta página">{(["all", "unread", "assigned"] as const).map((value) => <button key={value} type="button" aria-pressed={filter === value} className={filter === value ? "is-active" : ""} onClick={() => setFilter(value)}>{value === "all" ? "Todas" : value === "unread" ? "Não lidas" : "Atribuídas"}</button>)}</div></header>
        <div>{filtered.map((thread) => <button key={thread.id} className={`${selectedId === thread.id ? "is-active" : ""} ${thread.unread ? "is-unread" : ""}`} onClick={() => setSelectedId(thread.id)}><span className="outreach-thread-avatar">{thread.contactName?.slice(0, 2).toUpperCase() || "?"}</span><span><span><strong>{thread.contactName || thread.contactEmail}</strong><time>{formatDateTime(thread.lastMessageAt)}</time></span><b>{thread.subject}</b><small>{thread.preview}</small><em>{classificationLabels[thread.classification] ?? thread.classification}</em></span></button>)}{!filtered.length ? <EmptyPanel icon={<Inbox size={20} />} title="Sem respostas" description="Não existem conversas para este filtro nesta página." /> : null}</div>
        <OutreachPagination page={threads.data?.page} onPageChange={(nextPage) => { setSelectedId(""); setPage(nextPage); }} />
      </aside>
      <article className="outreach-thread-detail">
        {!selectedId ? <EmptyPanel icon={<Mail size={22} />} title="Seleciona uma conversa" description="As mensagens e ações aparecem aqui." /> : detail.isLoading ? <OutreachLoading label="A abrir conversa…" /> : detail.isError || !detail.data ? <OutreachError error={detail.error} retry={() => void detail.refetch()} /> : <>
          <header><button className="outreach-thread-back" onClick={() => setSelectedId("")} aria-label="Voltar à lista"><ArrowLeft size={17} /></button><div><h3>{detail.data.subject}</h3><p>{detail.data.contactName} · {detail.data.contactEmail} · {detail.data.companyName}</p></div><Button variant="ghost" onClick={() => action.mutate({ action: "archive" })}><Archive size={15} />Arquivar</Button></header>
          <div className="outreach-thread-controls"><label>Classificação<select value={detail.data.classification} onChange={(event) => action.mutate({ action: "classify", payload: { classification: event.target.value } })}>{Object.entries(classificationLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{access.can("outreach.thread.assign") ? <label>Responsável<select value={detail.data.assignedTo ?? ""} onChange={(event) => action.mutate({ action: "assign", payload: { profileId: event.target.value || null } })}><option value="">Sem atribuição</option>{team.map((member) => <option key={member.id} value={member.id}>{member.nome}</option>)}</select></label> : null}</div>
          <div className="outreach-messages">{detail.data.messages?.map((message) => <article key={message.id} className={`outreach-message outreach-message--${message.direction}`}><header><span>{message.direction === "inbound" ? <UserRound size={14} /> : <Mail size={14} />}{message.direction === "inbound" ? detail.data.contactName : detail.data.mailboxEmail}</span><time>{formatDateTime(message.occurredAt)}</time></header><p>{message.body}</p><small>{message.status}</small></article>)}</div>
          <form className="outreach-reply" onSubmit={(event) => void reply(event)}><label htmlFor="outreach-reply-body">Responder nesta thread</label><textarea id="outreach-reply-body" name="body" rows={4} required placeholder="Escreve uma resposta clara e contextual…" />{action.isError ? <div className="outreach-inline-error" role="alert">{action.error instanceof Error ? action.error.message : "Não foi possível responder."}</div> : null}<footer><span>O envio é manual e fica registado na auditoria.</span><Button type="submit" disabled={action.isPending}><Send size={15} />{action.isPending ? "A enviar…" : "Enviar resposta"}</Button></footer></form>
        </>}
      </article>
    </section>
  </div>;
}
