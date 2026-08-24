import { useMemo, useRef, useState } from "react";
import { createColumnHelper, flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable, type PaginationState, type SortingState } from "@tanstack/react-table";
import { ArrowDownUp, Check, Download, MailPlus, Search, Upload, X } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { stageLabels, stageOrder, stageProbability } from "../data/seed";
import { csvFieldLabels, csvRecord, parseCsv, stageFromText, verticalFromText, type CsvField, type ParsedCsv } from "../lib/csv-import";
import { useCRM } from "../state/crm-context";
import type { Lead, Opportunity, Stage, Vertical } from "../types";
import { Avatar, Button, Card, Modal, PageHeader } from "../components/ui";

const helper = createColumnHelper<Lead>();

export function LeadsPage() {
  const { leads, opportunities, updateLead, team, importBatch, setEmailSelection, dataMode } = useCRM();
  const [query, setQuery] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 50 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importOpen, setImportOpen] = useState(false);
  const [importData, setImportData] = useState<ParsedCsv | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const columns = useMemo(() => [
    helper.display({ id: "select", header: () => <input type="checkbox" aria-label="Selecionar todos" checked={selected.size === leads.length && leads.length > 0} onChange={(event) => setSelected(event.target.checked ? new Set(leads.map((lead) => lead.id)) : new Set())} />, cell: ({ row }) => <input type="checkbox" aria-label={`Selecionar ${row.original.nome}`} checked={selected.has(row.original.id)} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(row.original.id); else next.delete(row.original.id); return next; })} /> }),
    helper.accessor("nome", { header: "Contacto", cell: ({ row, getValue }) => <div className="contact-cell"><span className="company-monogram">{getValue().split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><span><input value={getValue()} onChange={(event) => updateLead(row.original.id, "nome", event.target.value)} /><input className="inline-subedit" value={row.original.cargo} aria-label={`Cargo de ${getValue()}`} onChange={(event) => updateLead(row.original.id, "cargo", event.target.value)} /></span></div> }),
    helper.accessor("empresa", { header: "Empresa", cell: ({ row, getValue }) => <span className="company-cell-edit"><Link to="/empresas/$companyId" params={{ companyId: row.original.empresaId ?? row.original.id }}>{getValue()}</Link><input className="inline-edit" aria-label={`Editar empresa ${getValue()}`} value={getValue()} onChange={(event) => updateLead(row.original.id, "empresa", event.target.value)} /></span> }),
    helper.accessor("email", { header: "Email", cell: ({ row, getValue }) => <input className="inline-edit inline-edit--wide" type="email" value={getValue()} onChange={(event) => updateLead(row.original.id, "email", event.target.value)} /> }),
    helper.accessor("telefone", { header: "Telefone", cell: ({ row, getValue }) => <input className="inline-edit mono" value={getValue()} onChange={(event) => updateLead(row.original.id, "telefone", event.target.value)} /> }),
    helper.accessor("vertical", { header: "Vertical", cell: ({ row, getValue }) => <select className="inline-select" value={getValue()} onChange={(event) => updateLead(row.original.id, "vertical", event.target.value)}><option>Outro</option><option>Metalomecânica</option><option>Automóvel</option><option>Alumínio</option><option>Cortiça</option><option>Compósitos</option><option>Eletrónica</option></select> }),
    helper.accessor("estado", { header: "Estado", cell: ({ row, getValue }) => <select className="inline-select inline-select--stage" value={getValue()} onChange={(event) => updateLead(row.original.id, "estado", event.target.value)}>{[...stageOrder, "adiado" as const].map((stage) => <option key={stage} value={stage}>{stageLabels[stage]}</option>)}</select> }),
    helper.accessor("ownerId", { header: "Responsável", cell: ({ row, getValue }) => <div className="owner-cell"><Avatar ownerId={getValue()} size="sm" /><select className="inline-select" value={getValue()} onChange={(event) => updateLead(row.original.id, "ownerId", event.target.value)}>{team.map((owner) => <option key={owner.id} value={owner.id}>{owner.nome}</option>)}</select></div> }),
  ], [leads, selected, team, updateLead]);

  const table = useReactTable({ data: leads, columns, state: { globalFilter: query, sorting, pagination }, onGlobalFilterChange: setQuery, onSortingChange: setSorting, onPaginationChange: setPagination, getCoreRowModel: getCoreRowModel(), getFilteredRowModel: getFilteredRowModel(), getSortedRowModel: getSortedRowModel(), getPaginationRowModel: getPaginationRowModel() });

  function handleExport() {
    const header = "nome,empresa,email,telefone,vertical,estado,responsavel";
    const lines = leads.map((lead) => [lead.nome, lead.empresa, lead.email, lead.telefone, lead.vertical, stageLabels[lead.estado], team.find((owner) => owner.id === lead.ownerId)?.nome].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","));
    const url = URL.createObjectURL(new Blob([[header, ...lines].join("\n")], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "nikufra-leads.csv"; anchor.click(); URL.revokeObjectURL(url);
  }

  async function handleFile(file: File) {
    if (file.size > 5 * 1024 * 1024) { setImportError("O ficheiro ultrapassa o limite de 5 MB."); return; }
    const parsed = parseCsv(await file.text());
    if (!parsed.headers.length || !parsed.rows.length) { setImportError("O CSV está vazio ou não tem cabeçalho."); return; }
    setImportData(parsed);
    setImportError("");
  }

  function normalizedCompanyKey(value: string) { return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, ""); }
  function inferCompany(email: string) { const domain = email.split("@")[1]?.split(".")[0] ?? "Particular"; return domain.charAt(0).toUpperCase() + domain.slice(1); }
  function inferName(email: string) { return (email.split("@")[0] || "Contacto").split(/[._-]+/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" "); }
  function toDate(value: string) { const match = value.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/); if (match) return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`; const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10); }

  async function handleImport() {
    if (!importData) return;
    const seenEmails = new Set<string>();
    const existingCompanyByName = new Map(opportunities.map((item) => [normalizedCompanyKey(item.empresa), item]));
    const opportunityByCompany = new Map<string, Opportunity>();
    const newLeads: Lead[] = []; const newOpportunities: Opportunity[] = [];
    for (const row of importData.rows) {
      const record = csvRecord(importData, row);
      const email = (record.email ?? "").trim().toLowerCase();
      if (!email || !email.includes("@") || seenEmails.has(email)) continue;
      const contactName = (record.nome || inferName(email)).trim();
      const rawCompany = (record.empresa || inferCompany(email)).trim();
      const empresa = normalizedCompanyKey(rawCompany) === "particular" ? `${contactName} (particular)` : rawCompany;
      const key = normalizedCompanyKey(empresa) || crypto.randomUUID();
      const estado = stageFromText(record.estado ?? "") ?? "nao_contactado";
      const ownerName = (record.responsavel ?? "").toLowerCase();
      const ownerId = team.find((owner) => owner.nome.toLowerCase() === ownerName || owner.email.toLowerCase() === ownerName)?.id ?? team[0].id;
      let opportunity = opportunityByCompany.get(key);
      const companyId = opportunity?.empresaId ?? existingCompanyByName.get(key)?.empresaId ?? crypto.randomUUID();
      const leadId = crypto.randomUUID();
      const meetingDate = toDate(record.data_reuniao ?? "");
      const lead: Lead = { id: leadId, empresaId: companyId, nome: contactName, cargo: record.cargo ?? "", empresa, email, telefone: record.telefone ?? "", vertical: verticalFromText(record.vertical ?? ""), cidade: record.cidade ?? "", pais: record.pais || "PT", origem: "Importação CSV", estado, ownerId, dataReuniao: meetingDate || undefined };
      newLeads.push(lead); seenEmails.add(email);
      if (!opportunity) {
        opportunity = { id: crypto.randomUUID(), empresaId: companyId, leadId, empresa, titulo: record.oportunidade || "Oportunidade inicial", estado, tipo: "Consultoria", valor: Number(String(record.valor ?? "0").replace(/\s/g, "").replace(",", ".")) || 0, probabilidade: stageProbability[estado], ownerId, diasNoEstado: 0, dataPrimeiroContacto: "", dataReuniao: meetingDate || undefined, dataFecho: undefined, dataFechoPrevista: "" };
        opportunityByCompany.set(key, opportunity); newOpportunities.push(opportunity);
      } else if (stageProbability[estado] > opportunity.probabilidade) {
        opportunity.estado = estado; opportunity.probabilidade = stageProbability[estado];
        if (meetingDate) opportunity.dataReuniao = meetingDate;
      } else if (meetingDate && !opportunity.dataReuniao) {
        opportunity.dataReuniao = meetingDate;
      }
    }
    if (!newLeads.length) { setImportError("Nenhum contacto novo válido. Confirma a coluna de email ou verifica duplicados."); return; }
    setImportBusy(true); setImportError("");
    const includeNikufraFinancials = newLeads.length >= 400;
    try { await importBatch(newLeads, newOpportunities, { includeNikufraFinancials }); setImportOpen(false); setImportData(null); }
    catch (error) { setImportError(error instanceof Error ? error.message : "A importação falhou."); }
    finally { setImportBusy(false); }
  }

  return (
    <div className="page">
      <PageHeader eyebrow="Base comercial" title="Empresas e leads" description={`${leads.length} contactos ativos. Clica numa célula para editar sem sair da tabela.`} actions={<><Button variant="secondary" onClick={() => setImportOpen(true)}><Upload size={16} />Importar CSV</Button><Button variant="secondary" onClick={handleExport}><Download size={16} />Exportar</Button></>} />
      <Card className="data-table-card">
        <div className="table-toolbar"><div className="table-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pesquisar nome, empresa, email..." /><kbd>/</kbd></div><div>{selected.size ? <><span className="selection-count"><Check size={14} />{selected.size} selecionados</span><Link to="/email" onClick={() => setEmailSelection([...selected])}><Button><MailPlus size={16} />Criar rascunhos</Button></Link><Button variant="ghost" onClick={() => setSelected(new Set())}><X size={16} /></Button></> : <span className="row-count mono">{table.getFilteredRowModel().rows.length} linhas</span>}</div></div>
        <div className="table-scroll"><table className="data-table"><thead>{table.getHeaderGroups().map((group) => <tr key={group.id}>{group.headers.map((header) => <th key={header.id} onClick={header.column.getToggleSortingHandler()}>{flexRender(header.column.columnDef.header, header.getContext())}{header.column.getCanSort() ? <ArrowDownUp size={12} /> : null}</th>)}</tr>)}</thead><tbody>{table.getRowModel().rows.map((row) => <tr key={row.id}>{row.getVisibleCells().map((cell) => <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}</tr>)}</tbody></table></div>
        <div className="table-footer"><span>A mostrar {pagination.pageIndex * pagination.pageSize + 1}–{Math.min((pagination.pageIndex + 1) * pagination.pageSize, table.getFilteredRowModel().rows.length)} de {table.getFilteredRowModel().rows.length}</span><span className="pagination-controls"><Button variant="ghost" disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}>Anterior</Button><b className="mono">{pagination.pageIndex + 1}/{table.getPageCount()}</b><Button variant="ghost" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}>Seguinte</Button></span><span>{dataMode === "supabase" ? "Dados partilhados no servidor" : "Base Nikufra carregada localmente"}</span></div>
      </Card>

      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="Importar contactos" description="O CRM deteta o separador e reconhece colunas em português ou inglês. Podes corrigir o mapeamento antes de importar." width="820px">
        <div className="import-drop" onClick={() => fileRef.current?.click()}><Upload size={22} /><strong>Escolhe um CSV ou arrasta para aqui</strong><span>Deteção de duplicados por email · máximo 5 MB</span><input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(event) => event.target.files?.[0] && handleFile(event.target.files[0])} /></div>
        {importData ? <div className="import-preview"><div className="import-preview__head"><strong>{importData.rows.length} registos · separador {importData.delimiter === "\t" ? "tab" : importData.delimiter}</strong><span>{importData.mapping.filter(Boolean).length}/{importData.headers.length} campos reconhecidos</span></div><div className="mapping-grid">{importData.headers.map((header, index) => <label key={`${header}-${index}`}><span>{header}</span><select value={importData.mapping[index] ?? ""} onChange={(event) => setImportData((current) => current ? { ...current, mapping: current.mapping.map((field, fieldIndex) => fieldIndex === index ? (event.target.value || null) as CsvField | null : field) } : current)}><option value="">Ignorar coluna</option>{Object.entries(csvFieldLabels).map(([field, label]) => <option value={field} key={field}>{label}</option>)}</select></label>)}</div><table><thead><tr>{importData.headers.slice(0, 6).map((header, index) => <th key={`${header}-${index}`}>{header}</th>)}</tr></thead><tbody>{importData.rows.slice(0, 5).map((row, index) => <tr key={index}>{row.slice(0, 6).map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div> : null}
        {importError ? <div className="auth-error">{importError}</div> : null}
        <div className="modal__actions"><Button variant="secondary" onClick={() => setImportOpen(false)}>Cancelar</Button><Button disabled={!importData || importBusy} onClick={() => void handleImport()}>{importBusy ? "A importar…" : "Importar sem duplicados"}</Button></div>
      </Modal>
    </div>
  );
}
