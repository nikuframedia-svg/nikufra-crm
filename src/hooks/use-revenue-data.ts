import { useEffect, useState } from "react";
import { loadLocalRealData } from "../data/seed";
import { supabase } from "../lib/supabase";
import type { RevenueEntry, RevenueMonth } from "../types";

function emptyMonths(): Array<RevenueMonth & { key: string }> {
  const now = new Date();
  return Array.from({ length: 12 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - 11 + index, 1);
    return { key: `${date.getFullYear()}-${date.getMonth() + 1}`, mes: date.toLocaleDateString("pt-PT", { month: "short" }).replace(".", ""), contratualizado: 0, faturado: 0, recebido: 0, objetivo: 0 };
  });
}

export function useRevenueData() {
  const [entries, setEntries] = useState<RevenueEntry[]>([]);
  const [months, setMonths] = useState<RevenueMonth[]>(() => emptyMonths().map(({ key: _key, ...month }) => month));

  useEffect(() => {
    let active = true;
    if (!supabase) {
      void loadLocalRealData().then((data) => { if (active && data) { setEntries(data.realRevenueEntries); setMonths(data.realRevenueMonths); } });
      return () => { active = false; };
    }
    void Promise.all([
      supabase.from("faturacao").select("id,empresa_id,oportunidade_id,tipo,valor,valor_bruto,valor_iva,taxa_iva,data,descricao,referencia_externa,empresas(nome)").order("data", { ascending: false }),
      supabase.from("objetivos").select("ano,mes,tipo,valor_alvo").eq("tipo", "faturacao"),
    ]).then(([billing, goals]) => {
      if (!active || billing.error) return;
      const base = emptyMonths();
      for (const row of billing.data ?? []) { const date = new Date(row.data); const month = base.find((item) => item.key === `${date.getFullYear()}-${date.getMonth() + 1}`); if (month) month[row.tipo as "contratualizado" | "faturado" | "recebido"] += Number(row.valor); }
      for (const row of goals.data ?? []) { const month = base.find((item) => item.key === `${row.ano}-${row.mes}`); if (month) month.objetivo = Number(row.valor_alvo); }
      setMonths(base.map(({ key: _key, ...month }) => month));
      setEntries((billing.data ?? []).map((row) => ({ id: row.id, empresaId: row.empresa_id, oportunidadeId: row.oportunidade_id ?? undefined, data: row.data, empresa: (Array.isArray(row.empresas) ? row.empresas[0]?.nome : (row.empresas as { nome: string } | null)?.nome) ?? "Empresa", descricao: row.descricao, tipo: row.tipo === "faturado" ? "Faturado" : row.tipo === "recebido" ? "Recebido" : "Contratualizado", valor: Number(row.valor), valorBruto: row.valor_bruto == null ? undefined : Number(row.valor_bruto), iva: row.valor_iva == null ? undefined : Number(row.valor_iva), taxaIva: row.taxa_iva == null ? undefined : Number(row.taxa_iva), ref: row.referencia_externa ?? "—" })));
    });
    return () => { active = false; };
  }, []);

  return { entries, setEntries, months, setMonths };
}
