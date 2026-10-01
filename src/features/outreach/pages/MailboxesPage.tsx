import { useCallback, useState, type FormEvent } from "react";
import { Check, Gauge, MailPlus, PlugZap, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "../../../components/ui";
import { OutreachApiError } from "../api";
import { formatDateTime, formatNumber, MailboxBadge, ModuleDialog, OutreachError, OutreachLoading, OutreachPageHeader, ProgressBar } from "../components";
import { useCreateMailbox, useMailboxAction, useMailboxes, useStartMailboxOAuth } from "../hooks";

export function OutreachMailboxesPage() {
  const query = useMailboxes();
  const mailboxAction = useMailboxAction();
  const createMailbox = useCreateMailbox();
  const oauth = useStartMailboxOAuth();
  const [open, setOpen] = useState(false);
  const [draftMailbox, setDraftMailbox] = useState<{ id: string; email: string } | null>(null);
  const close = useCallback(() => setOpen(false), []);
  if (query.isLoading) return <OutreachLoading label="A carregar mailboxes…" />;
  if (query.isError) return <OutreachError error={query.error} retry={() => void query.refetch()} />;
  const mailboxes = query.data?.items ?? [];
  const capacity = mailboxes.filter((mailbox) => mailbox.status === "ready" && mailbox.sendEnabled).reduce((sum, mailbox) => sum + Math.max(0, mailbox.dailyLimit - mailbox.sentToday), 0);
  const duplicateMailbox = createMailbox.error instanceof OutreachApiError && createMailbox.error.status === 409;

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    try {
      const existing = mailboxes.find((item) => item.provider === "google" && item.email.toLowerCase() === email.toLowerCase());
      const mailbox = existing ?? (draftMailbox?.email.toLowerCase() === email.toLowerCase()
        ? draftMailbox
        : await createMailbox.mutateAsync({ provider: "google", email, displayName: String(form.get("senderName") ?? "").trim(), dailyLimit: 10, timezone: "Europe/Lisbon" }));
      setDraftMailbox({ id: mailbox.id, email });
      await oauth.mutateAsync({ mailboxId: mailbox.id, provider: "google", emailHint: email });
    } catch { /* Mutation state renders the actionable server message. */ }
  }

  return <div className="outreach-page">
    <OutreachPageHeader eyebrow="Infraestrutura de envio" title="Mailboxes" description="Contas de campanha separadas da integração Gmail pessoal do CRM. As credenciais ficam apenas no backend cifrado." actions={<Button onClick={() => setOpen(true)}><MailPlus size={15} />Ligar Google</Button>} />
    <section className="outreach-mailbox-strip"><div><PlugZap size={18} /><span><strong>{formatNumber(mailboxes.filter((item) => item.status === "ready").length)} prontas</strong><small>de {formatNumber(mailboxes.length)} mailboxes</small></span></div><div><Gauge size={18} /><span><strong>{formatNumber(capacity)} disponíveis</strong><small>capacidade restante hoje</small></span></div><p><ShieldCheck size={17} />Uma mailbox ligada não envia até `send_enabled`, a campanha e o modo global estarem aprovados.</p></section>
    <section className="outreach-mailbox-grid">{mailboxes.map((mailbox) => <article key={mailbox.id} className="outreach-mailbox-card"><header><span className="outreach-mailbox-avatar">{mailbox.senderName?.slice(0, 1).toUpperCase() || "@"}</span><span><strong>{mailbox.senderName}</strong><small>{mailbox.email}</small></span><MailboxBadge status={mailbox.status} /></header><div className="outreach-health"><span><b>{Math.round(mailbox.healthScore)}%</b><small>saúde</small></span><ProgressBar value={mailbox.healthScore} label={`Saúde de ${mailbox.email}`} /></div><dl><div><dt>Provider</dt><dd>{mailbox.provider === "google" ? "Google" : mailbox.provider}</dd></div><div><dt>Hoje</dt><dd>{formatNumber(mailbox.sentToday)} / {formatNumber(mailbox.dailyLimit)}</dd></div><div><dt>Respostas</dt><dd>{formatNumber(mailbox.repliesToday)}</dd></div><div><dt>Bounce</dt><dd>{(mailbox.bounceRate || 0).toLocaleString("pt-PT", { maximumFractionDigits: 2 })}%</dd></div></dl><div className="outreach-dns"><span className={mailbox.authentication?.spf ? "is-ok" : ""}>{mailbox.authentication?.spf ? <Check size={12} /> : null}SPF</span><span className={mailbox.authentication?.dkim ? "is-ok" : ""}>{mailbox.authentication?.dkim ? <Check size={12} /> : null}DKIM</span><span className={mailbox.authentication?.dmarc ? "is-ok" : ""}>{mailbox.authentication?.dmarc ? <Check size={12} /> : null}DMARC</span></div>{mailbox.lastError ? <p className="outreach-mailbox-error">{mailbox.lastError}</p> : <p className="outreach-mailbox-sync">Última sincronização: {formatDateTime(mailbox.lastSyncAt)}</p>}<footer><Button variant="secondary" disabled={mailboxAction.isPending} onClick={() => mailboxAction.mutate({ id: mailbox.id, action: "test" })}><RefreshCw size={14} />Testar</Button><Button variant="ghost" disabled={mailboxAction.isPending} onClick={() => mailboxAction.mutate({ id: mailbox.id, action: "dns" })}><ShieldCheck size={14} />Rever DNS</Button>{mailbox.provider === "google" ? <Button variant="secondary" disabled={oauth.isPending} onClick={() => oauth.mutate({ mailboxId: mailbox.id, provider: "google", emailHint: mailbox.email })}><PlugZap size={14} />{oauth.isPending && oauth.variables?.mailboxId === mailbox.id ? "A abrir Google…" : mailbox.status === "disconnected" ? "Ligar" : "Reautorizar"}</Button> : null}</footer>{oauth.isError && oauth.variables?.mailboxId === mailbox.id ? <p className="outreach-inline-error" role="alert">{oauth.error instanceof Error ? oauth.error.message : "Não foi possível abrir a autorização Google."}</p> : null}</article>)}</section>
    {!mailboxes.length ? <section className="outreach-empty"><span><MailPlus size={22} /></span><h3>Liga a primeira mailbox</h3><p>No primeiro rollout só Google fica disponível. Microsoft e SMTP/IMAP permanecem desativados até terem testes próprios.</p><Button onClick={() => setOpen(true)}>Ligar Google</Button></section> : null}
    {mailboxAction.isError ? <div className="outreach-inline-error" role="alert">{mailboxAction.error instanceof Error ? mailboxAction.error.message : "O teste falhou."}</div> : null}

    <ModuleDialog open={open} onClose={close} title="Ligar mailbox Google" description="Abre a autorização Google e regressa ao CRM. A conta começa desligada para envios.">
      <form className="outreach-form" onSubmit={(event) => void connect(event)}><label>Nome do remetente<input name="senderName" required placeholder="Ex.: Maria · Nikufra" /></label><label>Email Google<input name="email" type="email" required placeholder="nome@nikufra.ai" /></label><div className="outreach-consent-note"><ShieldCheck size={16} /><p>O token OAuth não é exposto ao browser nem reutilizado da integração pessoal do CRM.</p></div>{oauth.isError || createMailbox.isError ? <div className="outreach-inline-error" role="alert">{duplicateMailbox ? "Esta mailbox já existe. Atualiza a lista e usa Ligar ou Reautorizar no cartão da conta." : (oauth.error ?? createMailbox.error) instanceof Error ? (oauth.error ?? createMailbox.error)?.message : "Não foi possível iniciar OAuth."}{duplicateMailbox ? <button type="button" onClick={() => { void query.refetch(); close(); }}>Atualizar lista</button> : null}</div> : null}<footer><Button type="button" variant="secondary" onClick={close}>Cancelar</Button><Button type="submit" disabled={oauth.isPending || createMailbox.isPending}>{oauth.isPending || createMailbox.isPending ? "A abrir Google…" : "Continuar com Google"}</Button></footer></form>
    </ModuleDialog>
  </div>;
}
