import { useEffect, useMemo, useState } from "react";
import { DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { AlertTriangle, ChevronDown, GripVertical, MousePointer2, Plus, Search, SlidersHorizontal, Trash2, X } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { pipelineBoardOrder, stageLabels, stageOrder, stageProbability } from "../data/seed";
import { formatCurrency } from "../lib/format";
import { useCRM } from "../state/crm-context";
import type { Lead, Opportunity, Stage, Vertical } from "../types";
import { Avatar, Button, EmptyState, Modal, PageHeader } from "../components/ui";

function normalizeSearch(value: string) {
  return value.toLocaleLowerCase("pt").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

function OpportunityCard({ item, overlay = false, canDelete = false, onDelete, onKeyboardMove }: { item: Opportunity; overlay?: boolean; canDelete?: boolean; onDelete?: (item: Opportunity) => void; onKeyboardMove?: (item: Opportunity, direction: -1 | 1) => void }) {
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, isDragging } = useDraggable({ id: item.id, disabled: overlay });
  const isRejected = item.estado === "perdido";
  return (
    <article
      ref={setNodeRef}
      className={`opportunity-card ${isDragging ? "is-dragging" : ""} ${overlay ? "is-overlay" : ""}`}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
      onPointerDown={overlay ? undefined : (event) => listeners?.onPointerDown?.(event)}
    >
      <div className="opportunity-card__meta"><span>{item.tipo}</span><span className="opportunity-card__actions">{canDelete && !overlay ? <button className="card-delete" aria-label={`Apagar ${item.empresa}`} title="Apagar registo comercial" onPointerDown={(event) => event.stopPropagation()} onClick={() => onDelete?.(item)}><Trash2 size={14} /></button> : null}<button type="button" ref={setActivatorNodeRef} className="drag-handle" aria-label={`Mover ${item.empresa} para outra etapa. Usa as setas esquerda e direita.`} title="Arrastar ou usar as setas esquerda e direita" {...attributes} {...listeners} onPointerDown={(event) => { event.stopPropagation(); listeners?.onPointerDown?.(event); }} onKeyDown={(event) => { if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return; event.preventDefault(); event.stopPropagation(); onKeyboardMove?.(item, event.key === "ArrowLeft" ? -1 : 1); }}><GripVertical size={14} /><span>Mover</span></button></span></div>
      {overlay ? <h3>{item.empresa}</h3> : <Link to="/empresas/$companyId" params={{ companyId: item.empresaId ?? item.id }} className="opportunity-card__link"><h3>{item.empresa}</h3></Link>}<p>{item.titulo}</p>
      <div className="opportunity-card__value"><strong className="mono">{formatCurrency(isRejected ? item.valorProposta ?? 0 : item.valor)}</strong><span className={isRejected ? "" : "mono"}>{isRejected ? "preço proposto" : `${item.probabilidade}%`}</span></div>
      <div className="opportunity-card__foot"><span className={`age-badge age-badge--${item.diasNoEstado > 30 ? "danger" : item.diasNoEstado >= 14 ? "warning" : "good"}`}>{item.diasNoEstado}d</span><Avatar ownerId={item.ownerId} size="sm" /></div>
    </article>
  );
}

function PipelineColumn({ stage, items, canDelete, onDelete, onKeyboardMove }: { stage: Stage; items: Opportunity[]; canDelete: boolean; onDelete: (item: Opportunity) => void; onKeyboardMove: (item: Opportunity, direction: -1 | 1) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const [limit, setLimit] = useState(40);
  const total = stage === "perdido"
    ? items.reduce((sum, item) => sum + (item.valorProposta ?? 0), 0)
    : items.reduce((sum, item) => sum + item.valor * item.probabilidade / 100, 0);
  return (
    <section ref={setNodeRef} className={`pipeline-column ${isOver ? "is-over" : ""}`} data-stage={stage}>
      <header><div><span className={`stage-dot stage-dot--${stage}`} /><h2>{stageLabels[stage]}</h2><b>{items.length}</b></div><p className="mono">{formatCurrency(total)} {stage === "perdido" ? "em propostas" : "ponderado"}</p></header>
      {isOver ? <div className="pipeline-drop-cue" aria-hidden="true">Largar em {stageLabels[stage]}</div> : null}
      <div className="pipeline-column__body">{items.length ? <>{items.slice(0, limit).map((item) => <OpportunityCard item={item} key={item.id} canDelete={canDelete} onDelete={onDelete} onKeyboardMove={onKeyboardMove} />)}{items.length > limit ? <button className="show-more" onClick={() => setLimit((value) => value + 40)}>Mostrar mais {Math.min(40, items.length - limit)} de {items.length}</button> : null}</> : <EmptyState>Sem oportunidades. Arrasta um cartão para aqui.</EmptyState>}</div>
    </section>
  );
}

export function PipelinePage() {
  const { opportunities, leads, moveOpportunity, addOpportunity, deleteCommercialRecords, team, currentUserId } = useCRM();
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [verticalFilter, setVerticalFilter] = useState("all");
  const [companySearch, setCompanySearch] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [lostPending, setLostPending] = useState<string | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [deletePending, setDeletePending] = useState<Opportunity | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [moveError, setMoveError] = useState("");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 7 } }),
  );
  const verticalByCompany = useMemo(() => new Map(leads.map((lead) => [lead.empresaId ?? lead.empresa, lead.vertical])), [leads]);
  const verticals = useMemo(() => [...new Set(leads.map((lead) => lead.vertical))].sort(), [leads]);
  const normalizedCompanySearch = useMemo(() => normalizeSearch(companySearch), [companySearch]);
  const filtered = useMemo(() => opportunities.filter((item) => (ownerFilter === "all" || item.ownerId === ownerFilter) && (verticalFilter === "all" || verticalByCompany.get(item.empresaId ?? item.empresa) === verticalFilter) && (!normalizedCompanySearch || normalizeSearch(item.empresa).includes(normalizedCompanySearch))), [opportunities, ownerFilter, verticalByCompany, verticalFilter, normalizedCompanySearch]);
  const itemsByStage = useMemo(() => {
    const grouped = new Map<Stage, Opportunity[]>();
    for (const stage of [...stageOrder, "adiado", "perdido"] as Stage[]) grouped.set(stage, []);
    for (const item of filtered) grouped.get(item.estado)?.push(item);
    return grouped;
  }, [filtered]);
  const weightedPipeline = useMemo(() => filtered.reduce((sum, item) => stageOrder.includes(item.estado) ? sum + item.valor * item.probabilidade / 100 : sum, 0), [filtered]);
  const terminalCount = itemsByStage.get("adiado")?.length ?? 0;
  const activeItem = opportunities.find((item) => item.id === activeId);
  const canDelete = team.find((owner) => owner.id === currentUserId)?.role === "admin";
  const deleteContactCount = deletePending ? leads.filter((lead) => lead.empresaId === deletePending.empresaId || lead.id === deletePending.leadId).length : 0;

  useEffect(() => {
    const handleNewShortcut = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "n" && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement) && !(event.target instanceof HTMLSelectElement)) setNewOpen(true);
    };
    window.addEventListener("keydown", handleNewShortcut);
    return () => window.removeEventListener("keydown", handleNewShortcut);
  }, []);

  useEffect(() => {
    if (!normalizedCompanySearch || !filtered.length) return;
    const resultStage = filtered[0].estado;
    if (resultStage === "adiado" && !terminalOpen) {
      setTerminalOpen(true);
      return;
    }
    const animationFrame = window.requestAnimationFrame(() => scrollToStage(resultStage));
    return () => window.cancelAnimationFrame(animationFrame);
  }, [filtered, normalizedCompanySearch, terminalOpen]);

  function handleDragStart(event: DragStartEvent) { setActiveId(String(event.active.id)); }
  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    if (!event.over) return;
    const stage = String(event.over.id) as Stage;
    if (stage === "perdido") setLostPending(String(event.active.id));
    else if ([...stageOrder, "adiado"].includes(stage)) void handleMove(String(event.active.id), stage);
  }

  function handleKeyboardMove(item: Opportunity, direction: -1 | 1) {
    const currentIndex = pipelineBoardOrder.indexOf(item.estado);
    if (currentIndex < 0) return;
    const nextStage = pipelineBoardOrder[currentIndex + direction];
    if (nextStage === "perdido") setLostPending(item.id);
    else if (nextStage) void handleMove(item.id, nextStage);
  }

  async function handleMove(id: string, stage: Stage) {
    setMoveError("");
    try {
      await moveOpportunity(id, stage);
    } catch (error) {
      setMoveError(error instanceof Error ? error.message : "Não foi possível mover a oportunidade.");
    }
  }

  async function handleReject(form: HTMLFormElement) {
    if (!lostPending) return;
    const data = new FormData(form);
    setMoveError("");
    try {
      await moveOpportunity(lostPending, "perdido", {
        motivo: String(data.get("motivo")),
        notas: String(data.get("notas")),
        valorProposta: Number(data.get("valorProposta")),
      });
      setLostPending(null);
    } catch (error) {
      setMoveError(error instanceof Error ? error.message : "Não foi possível marcar a oportunidade como recusada.");
    }
  }

  function scrollToStage(stage: Stage) {
    document.querySelector<HTMLElement>(`[data-stage="${stage}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }

  function handleCreate(formData: FormData) {
    const id = crypto.randomUUID();
    const leadId = crypto.randomUUID();
    const estado = String(formData.get("estado")) as Stage;
    const ownerId = String(formData.get("ownerId"));
    const empresa = String(formData.get("empresa"));
    const contact = String(formData.get("contacto"));
    const lead: Lead = { id: leadId, nome: contact, cargo: String(formData.get("cargo")), empresa, email: String(formData.get("email")), telefone: String(formData.get("telefone")), vertical: String(formData.get("vertical")) as Vertical, cidade: "", pais: "PT", origem: "Registo manual", estado, ownerId };
    const opportunity: Opportunity = { id, leadId, empresa, titulo: String(formData.get("titulo")), estado, tipo: String(formData.get("tipo")) as Opportunity["tipo"], valor: Number(formData.get("valor")), probabilidade: stageProbability[estado], ownerId, diasNoEstado: 0, dataPrimeiroContacto: estado === "nao_contactado" ? "" : new Date().toISOString().slice(0, 10), dataFechoPrevista: String(formData.get("fecho")) };
    addOpportunity(opportunity, lead);
    setNewOpen(false);
  }

  async function handleDelete() {
    if (!deletePending) return;
    setDeleteBusy(true); setDeleteError("");
    try {
      await deleteCommercialRecords({
        companyIds: deletePending.empresaId ? [deletePending.empresaId] : [],
        opportunityIds: [deletePending.id],
      });
      setDeletePending(null);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Não foi possível apagar o registo comercial.");
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div className="page page--pipeline">
      <PageHeader eyebrow="Pipeline comercial" title="Oportunidades" description="Move cada oportunidade para a etapa seguinte. Todas as mudanças ficam registadas no histórico." actions={<Button onClick={() => setNewOpen(true)}><Plus size={16} />Nova oportunidade <kbd>N</kbd></Button>} />
      {moveError && !lostPending ? <div className="auth-error" role="alert">{moveError}</div> : null}
      <div className="toolbar"><div className="toolbar__group"><label className="pipeline-search"><Search size={14} aria-hidden="true" /><input type="search" value={companySearch} onChange={(event) => setCompanySearch(event.target.value)} placeholder="Pesquisar empresa…" aria-label="Pesquisar empresa no pipeline" />{companySearch ? <button type="button" onClick={() => setCompanySearch("")} aria-label="Limpar pesquisa"><X size={13} /></button> : null}</label><label className="select-button">Responsável<select value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)}><option value="all">Toda a equipa</option>{team.map((owner) => <option key={owner.id} value={owner.id}>{owner.nome}</option>)}</select><ChevronDown size={14} /></label><label className="select-button">Vertical<select value={verticalFilter} onChange={(event) => setVerticalFilter(event.target.value)}><option value="all">Todas</option>{verticals.map((vertical) => <option key={vertical}>{vertical}</option>)}</select><ChevronDown size={14} /></label><span className="pipeline-drag-help"><MousePointer2 size={14} />Agarra em qualquer zona livre do cartão</span></div><div className="toolbar__summary"><span>Pipeline ponderado</span><strong className="mono">{formatCurrency(weightedPipeline)}</strong></div></div>
      <nav className="pipeline-stage-nav" aria-label="Ir diretamente para uma etapa">
        {pipelineBoardOrder.map((stage) => <button type="button" key={stage} onClick={() => scrollToStage(stage)} aria-label={`Ver etapa ${stageLabels[stage]}`}><span className={`stage-dot stage-dot--${stage}`} /><span>{stageLabels[stage]}</span><b className="mono">{itemsByStage.get(stage)?.length ?? 0}</b></button>)}
      </nav>
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragCancel={() => setActiveId(null)} onDragEnd={handleDragEnd}>
        <div className="pipeline-board-scroll" role="region" aria-label="Etapas do pipeline" tabIndex={0}>
          <div className={`pipeline-board ${activeId ? "is-dragging" : ""}`}>{pipelineBoardOrder.map((stage) => <PipelineColumn key={stage} stage={stage} items={itemsByStage.get(stage) ?? []} canDelete={Boolean(canDelete)} onDelete={setDeletePending} onKeyboardMove={handleKeyboardMove} />)}<button className="terminal-toggle" onClick={() => setTerminalOpen((value) => !value)}><SlidersHorizontal size={15} /><span>Adiados</span><b>{terminalCount}</b></button>{terminalOpen ? <div className="terminal-columns"><PipelineColumn stage="adiado" items={itemsByStage.get("adiado") ?? []} canDelete={Boolean(canDelete)} onDelete={setDeletePending} onKeyboardMove={handleKeyboardMove} /></div> : null}</div>
        </div>
        <DragOverlay>{activeItem ? <OpportunityCard item={activeItem} overlay /> : null}</DragOverlay>
      </DndContext>

      <Modal open={newOpen} onClose={() => setNewOpen(false)} title="Nova oportunidade" description="Cria a empresa, contacto e oportunidade numa só operação." width="720px">
        <form onSubmit={(event) => { event.preventDefault(); handleCreate(new FormData(event.currentTarget)); }} className="form-stack">
          <div className="form-grid"><label>Empresa<input name="empresa" required autoFocus placeholder="Nome legal ou comercial" /></label><label>Título da oportunidade<input name="titulo" required placeholder="Ex.: Planeamento de produção" /></label></div>
          <div className="form-grid form-grid--3"><label>Contacto principal<input name="contacto" required /></label><label>Cargo<input name="cargo" /></label><label>Vertical<select name="vertical"><option>Outro</option><option>Metalomecânica</option><option>Automóvel</option><option>Alumínio</option><option>Cortiça</option><option>Compósitos</option><option>Eletrónica</option></select></label></div>
          <div className="form-grid"><label>Email<input name="email" type="email" required /></label><label>Telefone<input name="telefone" /></label></div>
          <div className="form-grid form-grid--3"><label>Valor estimado<input name="valor" type="number" min="0" required /></label><label>Tipo<select name="tipo"><option>Consultoria</option><option>Licença PP1</option><option>Piloto</option><option>Misto</option></select></label><label>Estado inicial<select name="estado">{stageOrder.map((stage) => <option value={stage} key={stage}>{stageLabels[stage]}</option>)}</select></label></div>
          <div className="form-grid"><label>Responsável<select name="ownerId">{team.map((owner) => <option value={owner.id} key={owner.id}>{owner.nome}</option>)}</select></label><label>Fecho previsto<input name="fecho" type="date" required /></label></div>
          <div className="modal__actions"><Button variant="secondary" type="button" onClick={() => setNewOpen(false)}>Cancelar</Button><Button type="submit">Criar oportunidade</Button></div>
        </form>
      </Modal>

      <Modal open={Boolean(lostPending)} onClose={() => { setLostPending(null); setMoveError(""); }} title="Marcar como recusado" description="Regista o preço apresentado — usa 0 quando não chegou a existir proposta.">
        <form onSubmit={(event) => { event.preventDefault(); void handleReject(event.currentTarget); }} className="form-stack"><label>Preço da proposta (€)<input className="mono" name="valorProposta" type="number" min="0" step="0.01" defaultValue="0" required autoFocus /></label><label>Motivo<select name="motivo" required><option value="">Selecionar...</option><option value="preco">Preço</option><option value="timing">Timing</option><option value="sem_orcamento">Sem orçamento</option><option value="concorrente">Concorrente</option><option value="sem_resposta">Sem resposta</option><option value="nao_prioritario">Não prioritário</option><option value="outro">Outro</option></select></label><label>Notas<textarea name="notas" rows={3} placeholder="Contexto útil para uma futura reativação." /></label>{moveError ? <div className="auth-error" role="alert">{moveError}</div> : null}<div className="modal__actions"><Button type="button" variant="secondary" onClick={() => { setLostPending(null); setMoveError(""); }}>Cancelar</Button><Button type="submit" variant="danger">Confirmar recusa</Button></div></form>
      </Modal>

      <Modal open={Boolean(deletePending)} onClose={() => !deleteBusy && setDeletePending(null)} title={`Apagar ${deletePending?.empresa ?? "registo comercial"}?`} description="A eliminação será refletida no Kanban e em Empresas e leads.">
        <div className="delete-contact-warning"><AlertTriangle size={20} /><div><strong>Esta operação não pode ser anulada.</strong><p>Serão removidos {deleteContactCount} contacto{deleteContactCount === 1 ? "" : "s"}, a empresa, a oportunidade, as atividades e a faturação associada. Os contactos apagados não serão reimportados pelo Google.</p></div></div>
        {deleteError ? <div className="auth-error">{deleteError}</div> : null}
        <div className="modal__actions"><Button variant="secondary" disabled={deleteBusy} onClick={() => setDeletePending(null)}>Cancelar</Button><Button variant="danger" disabled={deleteBusy} onClick={() => void handleDelete()}>{deleteBusy ? "A apagar…" : "Apagar definitivamente"}</Button></div>
      </Modal>
    </div>
  );
}
