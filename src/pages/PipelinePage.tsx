import { useEffect, useMemo, useState } from "react";
import { DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { ChevronDown, GripVertical, Plus, SlidersHorizontal } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { stageLabels, stageOrder, stageProbability } from "../data/seed";
import { formatCurrency } from "../lib/format";
import { useCRM } from "../state/crm-context";
import type { Lead, Opportunity, Stage, Vertical } from "../types";
import { Avatar, Button, EmptyState, Modal, PageHeader } from "../components/ui";

function OpportunityCard({ item, overlay = false }: { item: Opportunity; overlay?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: item.id, disabled: overlay });
  return (
    <article ref={setNodeRef} className={`opportunity-card ${isDragging ? "is-dragging" : ""} ${overlay ? "is-overlay" : ""}`} style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}>
      <div className="opportunity-card__meta"><span>{item.tipo}</span><button className="drag-handle" aria-label={`Mover ${item.empresa}`} {...listeners} {...attributes}><GripVertical size={14} /></button></div>
      {overlay ? <h3>{item.empresa}</h3> : <Link to="/empresas/$companyId" params={{ companyId: item.empresaId ?? item.id }} className="opportunity-card__link"><h3>{item.empresa}</h3></Link>}<p>{item.titulo}</p>
      <div className="opportunity-card__value"><strong className="mono">{formatCurrency(item.valor, true)}</strong><span className="mono">{item.probabilidade}%</span></div>
      <div className="opportunity-card__foot"><span className={`age-badge age-badge--${item.diasNoEstado > 30 ? "danger" : item.diasNoEstado >= 14 ? "warning" : "good"}`}>{item.diasNoEstado}d</span><Avatar ownerId={item.ownerId} size="sm" /></div>
    </article>
  );
}

function PipelineColumn({ stage, items }: { stage: Stage; items: Opportunity[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const [limit, setLimit] = useState(40);
  const weighted = items.reduce((sum, item) => sum + item.valor * item.probabilidade / 100, 0);
  return (
    <section ref={setNodeRef} className={`pipeline-column ${isOver ? "is-over" : ""}`}>
      <header><div><span className={`stage-dot stage-dot--${stage}`} /><h2>{stageLabels[stage]}</h2><b>{items.length}</b></div><p className="mono">{formatCurrency(weighted, true)} ponderado</p></header>
      <div className="pipeline-column__body">{items.length ? <>{items.slice(0, limit).map((item) => <OpportunityCard item={item} key={item.id} />)}{items.length > limit ? <button className="show-more" onClick={() => setLimit((value) => value + 40)}>Mostrar mais {Math.min(40, items.length - limit)} de {items.length}</button> : null}</> : <EmptyState>Sem oportunidades. Arrasta um cartão para aqui.</EmptyState>}</div>
    </section>
  );
}

export function PipelinePage() {
  const { opportunities, leads, moveOpportunity, addOpportunity, team } = useCRM();
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [verticalFilter, setVerticalFilter] = useState("all");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [lostPending, setLostPending] = useState<string | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const verticalByCompany = useMemo(() => new Map(leads.map((lead) => [lead.empresaId ?? lead.empresa, lead.vertical])), [leads]);
  const verticals = useMemo(() => [...new Set(leads.map((lead) => lead.vertical))].sort(), [leads]);
  const filtered = useMemo(() => opportunities.filter((item) => (ownerFilter === "all" || item.ownerId === ownerFilter) && (verticalFilter === "all" || verticalByCompany.get(item.empresaId ?? item.empresa) === verticalFilter)), [opportunities, ownerFilter, verticalByCompany, verticalFilter]);
  const activeItem = opportunities.find((item) => item.id === activeId);

  useEffect(() => {
    const handleNewShortcut = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "n" && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement) && !(event.target instanceof HTMLSelectElement)) setNewOpen(true);
    };
    window.addEventListener("keydown", handleNewShortcut);
    return () => window.removeEventListener("keydown", handleNewShortcut);
  }, []);

  function handleDragStart(event: DragStartEvent) { setActiveId(String(event.active.id)); }
  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    if (!event.over) return;
    const stage = String(event.over.id) as Stage;
    if (stage === "perdido") setLostPending(String(event.active.id));
    else if ([...stageOrder, "adiado"].includes(stage)) moveOpportunity(String(event.active.id), stage);
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

  return (
    <div className="page page--pipeline">
      <PageHeader eyebrow="Pipeline comercial" title="Oportunidades" description="Arrasta os cartões entre etapas. Todas as mudanças ficam registadas no histórico." actions={<Button onClick={() => setNewOpen(true)}><Plus size={16} />Nova oportunidade <kbd>N</kbd></Button>} />
      <div className="toolbar"><div className="toolbar__group"><label className="select-button">Responsável<select value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)}><option value="all">Toda a equipa</option>{team.map((owner) => <option key={owner.id} value={owner.id}>{owner.nome}</option>)}</select><ChevronDown size={14} /></label><label className="select-button">Vertical<select value={verticalFilter} onChange={(event) => setVerticalFilter(event.target.value)}><option value="all">Todas</option>{verticals.map((vertical) => <option key={vertical}>{vertical}</option>)}</select><ChevronDown size={14} /></label></div><div className="toolbar__summary"><span>Pipeline ponderado</span><strong className="mono">{formatCurrency(filtered.filter((item) => stageOrder.includes(item.estado)).reduce((sum, item) => sum + item.valor * item.probabilidade / 100, 0), true)}</strong></div></div>
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="pipeline-board">{stageOrder.map((stage) => <PipelineColumn key={stage} stage={stage} items={filtered.filter((item) => item.estado === stage)} />)}<button className="terminal-toggle" onClick={() => setTerminalOpen((value) => !value)}><SlidersHorizontal size={15} /><span>Fora do funil</span><b>{filtered.filter((item) => item.estado === "perdido" || item.estado === "adiado").length}</b></button>{terminalOpen ? <div className="terminal-columns"><PipelineColumn stage="adiado" items={filtered.filter((item) => item.estado === "adiado")} /><PipelineColumn stage="perdido" items={filtered.filter((item) => item.estado === "perdido")} /></div> : null}</div>
        <DragOverlay>{activeItem ? <OpportunityCard item={activeItem} overlay /> : null}</DragOverlay>
      </DndContext>

      <Modal open={newOpen} onClose={() => setNewOpen(false)} title="Nova oportunidade" description="Cria a empresa, contacto e oportunidade numa só operação." width="720px">
        <form onSubmit={(event) => { event.preventDefault(); handleCreate(new FormData(event.currentTarget)); }} className="form-stack">
          <div className="form-grid"><label>Empresa<input name="empresa" required autoFocus placeholder="Nome legal ou comercial" /></label><label>Título da oportunidade<input name="titulo" required placeholder="Ex.: Planeamento de produção" /></label></div>
          <div className="form-grid form-grid--3"><label>Contacto principal<input name="contacto" required /></label><label>Cargo<input name="cargo" /></label><label>Vertical<select name="vertical"><option>Outro</option><option>Metalomecânica</option><option>Automóvel</option><option>Alumínio</option><option>Cortiça</option><option>Compósitos</option><option>Eletrónica</option></select></label></div>
          <div className="form-grid"><label>Email<input name="email" type="email" required /></label><label>Telefone<input name="telefone" /></label></div>
          <div className="form-grid form-grid--3"><label>Valor estimado<input name="valor" type="number" min="0" required /></label><label>Tipo<select name="tipo"><option>Consultoria</option><option>Licença PP1</option><option>Piloto</option><option>Misto</option></select></label><label>Estado inicial<select name="estado">{stageOrder.map((stage) => <option value={stage} key={stage}>{stageLabels[stage]}</option>)}</select></label></div>
          <div className="form-grid"><label>Responsável<select name="ownerId">{team.map((owner) => <option value={owner.id} key={owner.id}>{owner.nome}</option>)}</select></label><label>Fecho previsto<input name="fecho" type="date" required defaultValue="2026-12-15" /></label></div>
          <div className="modal__actions"><Button variant="secondary" type="button" onClick={() => setNewOpen(false)}>Cancelar</Button><Button type="submit">Criar oportunidade</Button></div>
        </form>
      </Modal>

      <Modal open={Boolean(lostPending)} onClose={() => setLostPending(null)} title="Marcar como perdido" description="O motivo é obrigatório para manter as métricas honestas.">
        <form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); if (lostPending) moveOpportunity(lostPending, "perdido", { motivo: String(data.get("motivo")), notas: String(data.get("notas")) }); setLostPending(null); }} className="form-stack"><label>Motivo<select name="motivo" required><option value="">Selecionar...</option><option value="preco">Preço</option><option value="timing">Timing</option><option value="sem_orcamento">Sem orçamento</option><option value="concorrente">Concorrente</option><option value="sem_resposta">Sem resposta</option><option value="nao_prioritario">Não prioritário</option><option value="outro">Outro</option></select></label><label>Notas<textarea name="notas" rows={3} placeholder="Contexto útil para uma futura reativação." /></label><div className="modal__actions"><Button type="button" variant="secondary" onClick={() => setLostPending(null)}>Cancelar</Button><Button type="submit" variant="danger">Confirmar perda</Button></div></form>
      </Modal>
    </div>
  );
}
