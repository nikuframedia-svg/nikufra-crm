import { useMemo, useRef, useState } from "react";
import { createColumnHelper, flexRender, getCoreRowModel, getFilteredRowModel, getSortedRowModel, useReactTable, type SortingState } from "@tanstack/react-table";
import { ArrowDownUp, Check, Download, MailPlus, Search, Upload, X } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { stageLabels, stageOrder, stageProbability } from "../data/seed";
import { useCRM } from "../state/crm-context";
import type { Lead, Opportunity, Stage, Vertical } from "../types";
import { Avatar, Button, Card, Modal, PageHeader } from "../components/ui";

const helper = createColumnHelper<Lead>();

export function LeadsPage() {
  const { leads, updateLead, team, addOpportunity, setEmailSelection } = useCRM();
  const [query, setQuery] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState<string[][]>([]);
  const [importError, setImportError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const columns = useMemo(() => [
    helper.display({ id: "select", header: () => <input type="checkbox" aria-label="Selecionar todos" checked={selected.size === leads.length && leads.length > 0} onChange={(event) => setSelected(event.target.checked ? new Set(leads.map((lead) => lead.id)) : new Set())} />, cell: ({ row }) => <input type="checkbox" aria-label={`Selecionar ${row.original.nome}`} checked={selected.has(row.original.id)} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(row.original.id); else next.delete(row.original.id); return next; })} /> }),
    helper.accessor("nome", { header: "Contacto", cell: ({ row, getValue }) => <div className="contact-cell"><span className="company-monogram">{getValue().split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><span><input value={getValue()} onChange={(event) => updateLead(row.original.id, "nome", event.target.value)} /><input className="inline-subedit" value={row.original.cargo} aria-label={`Cargo de ${getValue()}`} onChange={(event) => updateLead(row.original.id, "cargo", event.target.value)} /></span></div> }),
    helper.accessor("empresa", { header: "Empresa", cell: ({ row, getValue }) => <input className="inline-edit" value={getValue()} onChange={(event) => updateLead(row.original.id, "empresa", event.target.value)} /> }),
    helper.accessor("email", { header: "Email", cell: ({ row, getValue }) => <input className="inline-edit inline-edit--wide" type="email" value={getValue()} onChange={(event) => updateLead(row.original.id, "email", event.target.value)} /> }),
    helper.accessor("telefone", { header: "Telefone", cell: ({ row, getValue }) => <input className="inline-edit mono" value={getValue()} onChange={(event) => updateLead(row.original.id, "telefone", event.target.value)} /> }),
    helper.accessor("vertical", { header: "Vertical", cell: ({ row, getValue }) => <select className="inline-select" value={getValue()} onChange={(event) => updateLead(row.original.id, "vertical", event.target.value)}><option>Metalomecânica</option><option>Automóvel</option><option>Alumínio</option><option>Cortiça</option><option>Compósitos</option><option>Eletrónica</option></select> }),
    helper.accessor("estado", { header: "Estado", cell: ({ row, getValue }) => <select className="inline-select inline-select--stage" value={getValue()} onChange={(event) => updateLead(row.original.id, "estado", event.target.value)}>{[...stageOrder, "adiado" as const].map((stage) => <option key={stage} value={stage}>{stageLabels[stage]}</option>)}</select> }),
    helper.accessor("ownerId", { header: "Responsável", cell: ({ row, getValue }) => <div className="owner-cell"><Avatar ownerId={getValue()} size="sm" /><select className="inline-select" value={getValue()} onChange={(event) => updateLead(row.original.id, "ownerId", event.target.value)}>{team.map((owner) => <option key={owner.id} value={owner.id}>{owner.nome}</option>)}</select></div> }),
  ], [leads, selected, team, updateLead]);

  const table = useReactTable({ data: leads, columns, state: { globalFilter: query, sorting }, onGlobalFilterChange: setQuery, onSortingChange: setSorting, getCoreRowModel: getCoreRowModel(), getFilteredRowModel: getFilteredRowModel(), getSortedRowModel: getSortedRowModel() });

  function handleExport() {
    const header = "nome,empresa,email,telefone,vertical,estado,responsavel";
    const lines = leads.map((lead) => [lead.nome, lead.empresa, lead.email, lead.telefone, lead.vertical, stageLabels[lead.estado], team.find((owner) => owner.id === lead.ownerId)?.nome].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","));
    const url = URL.createObjectURL(new Blob([[header, ...lines].join("\n")], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "nikufra-leads.csv"; anchor.click(); URL.revokeObjectURL(url);
  }

  async function handleFile(file: File) {
    if (file.size > 5 * 1024 * 1024) { setImportError("O ficheiro ultrapassa o limite de 5 MB."); return; }
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(Boolean);
    const separator = (lines[0]?.match(/;/g)?.length ?? 0) > (lines[0]?.match(/,/g)?.length ?? 0) ? ";" : ",";
    const parseLine = (line: string) => { const cells: string[] = []; let cell = ""; let quoted = false; for (let index = 0; index < line.length; index += 1) { const char = line[index]; if (char === '"' && line[index + 1] === '"' && quoted) { cell += '"'; index += 1; } else if (char === '"') quoted = !quoted; else if (char === separator && !quoted) { cells.push(cell.trim()); cell = ""; } else cell += char; } cells.push(cell.trim()); return cells; };
    setImportRows(lines.map(parseLine));
    setImportError("");
  }

  function handleImport() {
    const [header = [], ...rows] = importRows;
    const keys = header.map((value) => value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim());
    const valueAt = (row: string[], key: string) => row[keys.indexOf(key)]?.trim() ?? "";
    const stageByLabel = Object.fromEntries(Object.entries(stageLabels).map(([key, value]) => [value.toLowerCase(), key])) as Record<string, Stage>;
    let imported = 0;
    for (const row of rows) {
      const nome = valueAt(row, "nome"); const empresa = valueAt(row, "empresa"); const email = valueAt(row, "email").toLowerCase();
      if (!nome || !empresa || !email || leads.some((lead) => lead.email.toLowerCase() === email)) continue;
      const verticalRaw = valueAt(row, "vertical") as Vertical;
      const vertical: Vertical = ["Metalomecânica", "Automóvel", "Alumínio", "Cortiça", "Compósitos", "Eletrónica"].includes(verticalRaw) ? verticalRaw : "Metalomecânica";
      const stateRaw = valueAt(row, "estado").toLowerCase();
      const estado = (stageByLabel[stateRaw] ?? (stageOrder.includes(stateRaw as Stage) ? stateRaw : "nao_contactado")) as Stage;
      const ownerName = valueAt(row, "responsavel").toLowerCase();
      const ownerId = team.find((owner) => owner.nome.toLowerCase() === ownerName || owner.email.toLowerCase() === ownerName)?.id ?? team[0].id;
      const leadId = crypto.randomUUID(); const opportunityId = crypto.randomUUID();
      const lead: Lead = { id: leadId, nome, cargo: valueAt(row, "cargo"), empresa, email, telefone: valueAt(row, "telefone"), vertical, cidade: valueAt(row, "cidade"), pais: valueAt(row, "pais") || "PT", origem: "Importação CSV", estado, ownerId };
      const opportunity: Opportunity = { id: opportunityId, leadId, empresa, titulo: valueAt(row, "oportunidade") || "Oportunidade inicial", estado, tipo: "Consultoria", valor: Number(valueAt(row, "valor")) || 0, probabilidade: stageProbability[estado], ownerId, diasNoEstado: 0, dataPrimeiroContacto: estado === "nao_contactado" ? "" : new Date().toISOString().slice(0, 10), dataFechoPrevista: "" };
      addOpportunity(opportunity, lead); imported += 1;
    }
    if (!imported) { setImportError("Nenhum registo novo válido. Confirma as colunas nome, empresa e email, ou verifica duplicados."); return; }
    setImportOpen(false); setImportRows([]); setImportError("");
  }

  return (
    <div className="page">
      <PageHeader eyebrow="Base comercial" title="Empresas e leads" description={`${leads.length} contactos ativos. Clica numa célula para editar sem sair da tabela.`} actions={<><Button variant="secondary" onClick={() => setImportOpen(true)}><Upload size={16} />Importar CSV</Button><Button variant="secondary" onClick={handleExport}><Download size={16} />Exportar</Button></>} />
      <Card className="data-table-card">
        <div className="table-toolbar"><div className="table-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pesquisar nome, empresa, email..." /><kbd>/</kbd></div><div>{selected.size ? <><span className="selection-count"><Check size={14} />{selected.size} selecionados</span><Link to="/email" onClick={() => setEmailSelection([...selected])}><Button><MailPlus size={16} />Criar rascunhos</Button></Link><Button variant="ghost" onClick={() => setSelected(new Set())}><X size={16} /></Button></> : <span className="row-count mono">{table.getFilteredRowModel().rows.length} linhas</span>}</div></div>
        <div className="table-scroll"><table className="data-table"><thead>{table.getHeaderGroups().map((group) => <tr key={group.id}>{group.headers.map((header) => <th key={header.id} onClick={header.column.getToggleSortingHandler()}>{flexRender(header.column.columnDef.header, header.getContext())}{header.column.getCanSort() ? <ArrowDownUp size={12} /> : null}</th>)}</tr>)}</thead><tbody>{table.getRowModel().rows.map((row) => <tr key={row.id}>{row.getVisibleCells().map((cell) => <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}</tr>)}</tbody></table></div>
        <div className="table-footer"><span>A mostrar todos os resultados</span><span>Última sincronização: agora</span></div>
      </Card>

      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="Importar contactos" description="O ficheiro é validado localmente antes de qualquer escrita." width="720px">
        <div className="import-drop" onClick={() => fileRef.current?.click()}><Upload size={22} /><strong>Escolhe um CSV ou arrasta para aqui</strong><span>Deteção de duplicados por email · máximo 5 MB</span><input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(event) => event.target.files?.[0] && handleFile(event.target.files[0])} /></div>
        {importRows.length ? <div className="import-preview"><div className="import-preview__head"><strong>Pré-visualização</strong><span>{Math.max(0, importRows.length - 1)} registos lidos</span></div><table><tbody>{importRows.slice(0, 6).map((row, index) => <tr key={index}>{row.slice(0, 5).map((cell, cellIndex) => index === 0 ? <th key={cellIndex}>{cell}</th> : <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div> : null}
        {importError ? <div className="auth-error">{importError}</div> : null}
        <div className="modal__actions"><Button variant="secondary" onClick={() => setImportOpen(false)}>Cancelar</Button><Button disabled={importRows.length < 2} onClick={handleImport}>Importar registos válidos</Button></div>
      </Modal>
    </div>
  );
}
