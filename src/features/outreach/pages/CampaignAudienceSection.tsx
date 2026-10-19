import { useMemo, useRef, useState } from "react";
import { Plus, Upload } from "lucide-react";
import { Button, Modal } from "../../../components/ui";
import { csvContactName, csvFieldLabels, csvRecord, parseCsv, verticalFromText, type CsvField, type ParsedCsv } from "../../../lib/csv-import";
import { useCRM } from "../../../state/crm-context";
import type { Lead } from "../../../types";
import { formatNumber, OutreachPagination } from "../components";
import { useAddCampaignCsvContacts, useCampaignRecipients, useVerifyLeads } from "../hooks";
import type { CampaignDetail } from "../types";

const recipientStatus: Record<string, string> = {
  eligible: "Elegível", ineligible: "Bloqueado", pending: "Pendente", active: "Em curso",
  replied: "Respondeu", completed: "Concluído", suppressed: "Suprimido", bounced: "Bounce",
  reconciliation_required: "A reconciliar", deleted: "Eliminado",
};
const publicDomains = new Set(["gmail.com", "hotmail.com", "hotmail.pt", "outlook.com", "outlook.pt", "icloud.com", "me.com", "live.com", "live.pt", "yahoo.com", "yahoo.es", "sapo.pt"]);
function inferName(email: string) { return (email.split("@")[0] || "Contacto").split(/[._-]+/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" "); }
function inferCompany(email: string, name: string) {
  const domain = email.split("@")[1] ?? "";
  if (publicDomains.has(domain)) return `${name} (particular)`;
  const label = domain.split(".")[0] || "Empresa";
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function CampaignAudienceSection({ campaign, canManage }: { campaign: CampaignDetail; canManage: boolean }) {
  const { importBatch, currentUserId, leads, dataMode } = useCRM();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [fileName, setFileName] = useState("");
  const [listName, setListName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const recipients = useCampaignRecipients(campaign.id, page, canManage);
  const attach = useAddCampaignCsvContacts();
  const verify = useVerifyLeads();
  const editable = canManage && campaign.status === "draft";
  const rows = useMemo(() => {
    if (!parsed || !parsed.mapping.includes("email")) return [];
    const seen = new Set<string>();
    return parsed.rows.map((row) => csvRecord(parsed, row)).filter((record) => {
      const email = (record.email ?? "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || seen.has(email)) return false;
      seen.add(email); return true;
    });
  }, [parsed]);
  const knownEmails = useMemo(() => new Set(leads.map((lead) => lead.email.trim().toLowerCase()).filter(Boolean)), [leads]);
  const knownCount = rows.filter((row) => knownEmails.has((row.email ?? "").trim().toLowerCase())).length;

  function close() { if (busy) return; setOpen(false); setParsed(null); setFileName(""); setListName(""); setError(""); }
  async function loadFile(file: File) {
    setError(""); setResult(""); setParsed(null);
    if (file.size > 5 * 1024 * 1024) { setError("O CSV ultrapassa o limite de 5 MB."); return; }
    const next = parseCsv(await file.text());
    if (!next.headers.length || !next.rows.length) { setError("O CSV está vazio ou não tem cabeçalho."); return; }
    if (next.rows.length > 1000) { setError("O CSV tem mais de 1000 linhas. Divide-o em ficheiros mais pequenos."); return; }
    setParsed(next); setFileName(file.name);
    setListName(`${campaign.name} · ${file.name.replace(/\.csv$/i, "")}`.slice(0, 180));
  }

  async function importCsv() {
    if (!parsed || !rows.length || !listName.trim()) return;
    if (dataMode !== "supabase") { setError("Liga o CRM ao servidor antes de importar contactos para a campanha."); return; }
    setBusy(true); setError("");
    let savedToCrm = false;
    try {
      const importedLeads: Lead[] = rows.map((record) => {
        const email = record.email!.trim().toLowerCase();
        const name = csvContactName(record, inferName(email));
        return { id: crypto.randomUUID(), empresaId: crypto.randomUUID(), nome: name,
          empresa: record.empresa?.trim() || inferCompany(email, name), email,
          cargo: record.cargo?.trim() || "", telefone: record.telefone?.trim() || "",
          vertical: verticalFromText(record.vertical ?? ""), cidade: record.cidade?.trim() || "",
          pais: record.pais?.trim() || "PT", origem: "Importação CSV", estado: "nao_contactado", ownerId: currentUserId };
      });
      const imported = await importBatch(importedLeads, [], { contactsOnly: true });
      if (!imported) throw new Error("O CRM não devolveu os contactos importados.");
      savedToCrm = true;
      await verify.mutateAsync(imported.contacts.map((contact) => contact.id));
      const attached = await attach.mutateAsync({ campaignId: campaign.id, name: listName.trim(), contactIds: imported.contacts.map((contact) => contact.id) });
      setPage(1);
      setResult(`${formatNumber(attached.added)} contacto${attached.added === 1 ? "" : "s"} adicionado${attached.added === 1 ? "" : "s"} à campanha · ${formatNumber(attached.existing)} já associado${attached.existing === 1 ? "" : "s"} · ${formatNumber(imported.contactsCreated)} novo${imported.contactsCreated === 1 ? "" : "s"} no CRM · ${formatNumber(imported.contactsExisting)} já existente${imported.contactsExisting === 1 ? "" : "s"}.`);
      setOpen(false); setParsed(null);
    } catch (cause) {
      setError(`${savedToCrm ? "Os contactos foram guardados no CRM, mas não associados à campanha. Podes tentar novamente com o mesmo CSV; não serão duplicados. " : "Não foi possível importar o CSV. "}${cause instanceof Error ? cause.message : "Tenta novamente."}`);
    } finally { setBusy(false); }
  }

  return <section className="outreach-panel outreach-campaign-audience">
    <header><div><h3>Contactos da campanha</h3><p>Importa um CSV nesta campanha. O CRM reutiliza contactos com o mesmo email e avalia cada destinatário antes do envio.</p></div><span>{formatNumber(campaign.readiness.eligibleRecipientCount)} elegíveis de {formatNumber(campaign.recipientCount)}</span></header>
    {editable ? <div className="outreach-audience-attach"><Button type="button" onClick={() => { setResult(""); setOpen(true); }}><Plus size={15} />Adicionar lista</Button><span>CSV até 1000 contactos · sem duplicados pelo email</span></div> : null}
    {canManage && campaign.status !== "draft" ? <p className="outreach-field-help outreach-section-note">Esta campanha já foi lançada. Os destinatários em curso mantêm o seu histórico; importa novos contactos num novo rascunho.</p> : null}
    {result ? <p className="outreach-inline-success" role="status">{result}</p> : null}
    {recipients.isError ? <p className="outreach-inline-error" role="alert">{recipients.error instanceof Error ? recipients.error.message : "Não foi possível carregar os contactos."}</p> : null}
    {canManage && (recipients.data?.items ?? []).length ? <div className="outreach-recipient-table"><div className="outreach-table-scroll"><table className="outreach-table"><thead><tr><th>Contacto</th><th>Empresa</th><th>Estado</th></tr></thead><tbody>{recipients.data?.items.map((item) => <tr key={item.id}><td><strong>{item.contactName || "Contacto removido"}</strong><small>{item.email || "Sem email"}</small></td><td>{item.companyName || "—"}</td><td><span title={item.reasons.join(" · ")}>{recipientStatus[item.status] ?? item.status}</span>{item.reasons.length ? <small>{item.reasons.join(" · ")}</small> : null}</td></tr>)}</tbody></table></div><OutreachPagination page={recipients.data?.page} onPageChange={setPage} /></div> : <p className="outreach-panel-empty">Ainda não há contactos nesta campanha.{editable ? " Clica em Adicionar lista para importar um CSV." : ""}</p>}

    <Modal open={open} onClose={close} title="Adicionar lista à campanha" description={`Importa um CSV para “${campaign.name}”. Confirma as colunas antes de guardar os contactos no CRM e nesta campanha.`} width="960px">
      <div className="campaign-csv-import">
        <button className="import-drop" type="button" disabled={busy} onClick={() => fileRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) void loadFile(file); }}><Upload size={24} /><strong>Escolher CSV ou arrastar ficheiro</strong><span>{fileName || "Até 1000 linhas e 5 MB"}</span></button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void loadFile(file); event.target.value = ""; }} />
        {parsed ? <div className="import-preview"><div className="import-preview__head"><strong>{parsed.rows.length} linhas no CSV</strong><span>{parsed.mapping.filter(Boolean).length} de {parsed.headers.length} colunas associadas</span></div><p className="import-mapping-help">Confirma a coluna de email. Nome e empresa ajudam a personalizar as mensagens; se faltarem, serão inferidos.</p><div className="mapping-grid">{parsed.headers.map((header, index) => <label key={`${header}-${index}`}><span title={header}>{header || `Coluna ${index + 1}`}</span><select disabled={busy} value={parsed.mapping[index] ?? ""} onChange={(event) => setParsed((current) => current ? { ...current, mapping: current.mapping.map((field, fieldIndex) => fieldIndex === index ? (event.target.value || null) as CsvField | null : field === event.target.value ? null : field) } : current)}><option value="">Ignorar coluna</option>{Object.entries(csvFieldLabels).map(([field, label]) => <option value={field} key={field}>{label}</option>)}</select></label>)}</div><div className="campaign-csv-preview-scroll"><table><thead><tr>{parsed.headers.slice(0, 6).map((header, index) => <th key={`${header}-${index}`}>{header}</th>)}</tr></thead><tbody>{parsed.rows.slice(0, 5).map((row, index) => <tr key={index}>{row.slice(0, 6).map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div></div> : null}
        {parsed ? <><label className="campaign-csv-name">Nome desta importação<input value={listName} maxLength={180} disabled={busy} onChange={(event) => setListName(event.target.value)} /></label><p className="campaign-csv-counts"><strong>{rows.length} emails únicos válidos</strong> · {knownCount} já visíveis no CRM · {parsed.rows.length - rows.length} linhas sem email válido ou repetidas. A confirmação final de duplicados é feita no servidor.</p><p className="outreach-field-help">O CRM verifica os emails importados e adiciona os contactos à campanha. Não são enviados emails automaticamente; os bloqueios de envio continuam ativos.</p></> : null}
        {error ? <p className="outreach-inline-error" role="alert">{error}</p> : null}
        <div className="modal__actions"><Button variant="secondary" disabled={busy} onClick={close}>Cancelar</Button>{parsed ? <Button disabled={busy || !rows.length || !listName.trim()} onClick={() => void importCsv()}>{busy ? "A importar e verificar…" : `Adicionar ${rows.length} à campanha`}</Button> : null}</div>
      </div>
    </Modal>
  </section>;
}
