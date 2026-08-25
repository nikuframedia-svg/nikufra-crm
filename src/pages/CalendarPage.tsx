import { useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-shell";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, RefreshCw, Users, Video } from "lucide-react";
import { Button, EmptyState, PageHeader } from "../components/ui";
import { supabase } from "../lib/supabase";
import { useCRM } from "../state/crm-context";

interface GoogleCalendarEvent {
  id: string;
  user_id: string;
  titulo: string;
  inicio: string;
  fim: string;
  dia_inteiro: boolean;
  privado: boolean;
  localizacao: string | null;
  html_link: string | null;
  meet_link: string | null;
  participantes: number;
}

const dayNameFormatter = new Intl.DateTimeFormat("pt-PT", { weekday: "short" });
const dayNumberFormatter = new Intl.DateTimeFormat("pt-PT", { day: "2-digit" });
const monthFormatter = new Intl.DateTimeFormat("pt-PT", { month: "long", year: "numeric" });
const timeFormatter = new Intl.DateTimeFormat("pt-PT", { hour: "2-digit", minute: "2-digit" });

function startOfWeek(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date;
}

function addDays(value: Date, amount: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + amount);
  return date;
}

function dateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function weekLabel(start: Date, end: Date) {
  if (start.getMonth() === end.getMonth()) return `${start.getDate()}–${end.getDate()} de ${monthFormatter.format(start)}`;
  return `${start.toLocaleDateString("pt-PT", { day: "numeric", month: "short" })} – ${end.toLocaleDateString("pt-PT", { day: "numeric", month: "short", year: "numeric" })}`;
}

export function CalendarPage() {
  const { team } = useCRM();
  const queryClient = useQueryClient();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [syncing, setSyncing] = useState(false);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);
  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);

  const { data: events = [], isLoading, error } = useQuery({
    queryKey: ["google-team-calendar", weekStart.toISOString(), ownerFilter],
    enabled: Boolean(supabase),
    refetchInterval: 60_000,
    queryFn: async () => {
      let query = supabase!.from("google_calendar_events")
        .select("id,user_id,titulo,inicio,fim,dia_inteiro,privado,localizacao,html_link,meet_link,participantes")
        .lt("inicio", weekEnd.toISOString())
        .gt("fim", weekStart.toISOString())
        .order("inicio", { ascending: true });
      if (ownerFilter !== "all") query = query.eq("user_id", ownerFilter);
      const { data, error: queryError } = await query;
      if (queryError) throw queryError;
      return (data ?? []) as GoogleCalendarEvent[];
    },
  });

  const eventsByDay = useMemo(() => {
    const grouped = new Map<string, GoogleCalendarEvent[]>();
    for (const day of weekDays) {
      const dayStart = new Date(day);
      const dayEnd = addDays(dayStart, 1);
      grouped.set(dateKey(day), events.filter((event) => new Date(event.inicio) < dayEnd && new Date(event.fim) > dayStart));
    }
    return grouped;
  }, [events, weekDays]);

  async function openExternal(url: string) {
    if ("__TAURI_INTERNALS__" in window) await open(url);
    else window.open(url, "_blank", "noopener,noreferrer");
  }

  async function syncCalendar() {
    if (!supabase) return;
    setSyncing(true);
    try {
      const { error: syncError } = await supabase.functions.invoke("gmail-sync", { body: {} });
      if (syncError) throw syncError;
      await queryClient.invalidateQueries({ queryKey: ["google-team-calendar"] });
    } finally {
      setSyncing(false);
    }
  }

  const todayKey = dateKey(new Date());
  const connectedOwners = new Set(events.map((event) => event.user_id)).size;

  return (
    <div className="page calendar-page">
      <PageHeader eyebrow="Google Calendar" title="Calendário da equipa" description="Agenda partilhada das contas Google ligadas ao CRM. Eventos privados mostram apenas a disponibilidade." actions={<Button onClick={() => void syncCalendar()} disabled={syncing}><RefreshCw size={16} className={syncing ? "spin" : ""} />{syncing ? "A sincronizar…" : "Sincronizar agora"}</Button>} />

      <div className="calendar-toolbar">
        <div className="calendar-navigation">
          <Button variant="secondary" onClick={() => setWeekStart(startOfWeek(new Date()))}>Hoje</Button>
          <button className="icon-button calendar-arrow" onClick={() => setWeekStart((current) => addDays(current, -7))} aria-label="Semana anterior"><ChevronLeft size={17} /></button>
          <button className="icon-button calendar-arrow" onClick={() => setWeekStart((current) => addDays(current, 7))} aria-label="Semana seguinte"><ChevronRight size={17} /></button>
          <strong>{weekLabel(weekStart, addDays(weekEnd, -1))}</strong>
        </div>
        <div className="calendar-toolbar__right">
          <span className="calendar-source"><CalendarDays size={14} />Google direto · atualização a cada 15 min</span>
          <label className="select-button"><Users size={14} />{ownerFilter === "all" ? "Toda a equipa" : team.find((owner) => owner.id === ownerFilter)?.nome ?? "Utilizador"}<select value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)}><option value="all">Toda a equipa</option>{team.map((owner) => <option key={owner.id} value={owner.id}>{owner.nome}</option>)}</select><ChevronDown size={13} /></label>
        </div>
      </div>

      <section className="team-calendar" aria-label={`Semana de ${weekLabel(weekStart, addDays(weekEnd, -1))}`}>
        <div className="team-calendar__status"><span><i />{connectedOwners || 0} {connectedOwners === 1 ? "agenda com eventos nesta semana" : "agendas com eventos nesta semana"}</span><span>{events.length} {events.length === 1 ? "evento visível" : "eventos visíveis"}</span></div>
        <div className="calendar-week">
          {weekDays.map((day) => {
            const key = dateKey(day);
            const dayEvents = eventsByDay.get(key) ?? [];
            return (
              <section className={`calendar-day ${key === todayKey ? "is-today" : ""}`} key={key}>
                <header><span>{dayNameFormatter.format(day).replace(".", "")}</span><strong>{dayNumberFormatter.format(day)}</strong></header>
                <div className="calendar-day__events">
                  {isLoading ? <><i className="calendar-skeleton" /><i className="calendar-skeleton calendar-skeleton--short" /></> : null}
                  {!isLoading && !dayEvents.length ? <span className="calendar-day__empty">Sem eventos</span> : null}
                  {dayEvents.map((event) => {
                    const owner = team.find((item) => item.id === event.user_id);
                    return (
                      <article className={`calendar-event ${event.privado ? "is-private" : ""}`} style={{ "--event-color": owner?.cor ?? "#3b82f6" } as React.CSSProperties} key={`${key}-${event.id}`}>
                        <div className="calendar-event__owner"><span style={{ background: owner?.cor ?? "#3b82f6" }} />{owner?.nome ?? "Equipa Nikufra"}</div>
                        <strong>{event.titulo}</strong>
                        <time>{event.dia_inteiro ? "Dia inteiro" : `${timeFormatter.format(new Date(event.inicio))}–${timeFormatter.format(new Date(event.fim))}`}</time>
                        {!event.privado && event.localizacao ? <small>{event.localizacao}</small> : null}
                        <div className="calendar-event__foot"><span>{event.participantes} {event.participantes === 1 ? "participante" : "participantes"}</span>{event.meet_link ? <button onClick={() => void openExternal(event.meet_link!)} aria-label={`Abrir Google Meet de ${event.titulo}`}><Video size={13} /></button> : null}{event.html_link ? <button onClick={() => void openExternal(event.html_link!)} aria-label={`Abrir ${event.titulo} no Google Calendar`}><ExternalLink size={13} /></button> : null}</div>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
        {!supabase ? <EmptyState>O calendário Google requer o servidor local ligado.</EmptyState> : null}
        {error ? <div className="auth-error">Não foi possível carregar o calendário. Confirma a ligação Google nas Definições.</div> : null}
      </section>
    </div>
  );
}
