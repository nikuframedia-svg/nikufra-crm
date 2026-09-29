import type { FollowUpSuggestion } from "../types";

export interface RankedFollowUp extends FollowUpSuggestion {
  daysSinceLastInteraction: number;
}

export function isWithinDayRange(days: number, minimum: number | null, maximum: number | null) {
  return (minimum === null || days >= minimum) && (maximum === null || days <= maximum);
}

export function daysSinceLastInteraction(value: string, now = new Date()) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 0;
  return Math.max(0, Math.floor((now.getTime() - timestamp) / 86_400_000));
}

export function rankFollowUps(items: FollowUpSuggestion[], now = new Date()): RankedFollowUp[] {
  return items
    .map((item) => ({
      ...item,
      daysSinceLastInteraction: daysSinceLastInteraction(item.ultimaInteracaoEm, now),
    }))
    .sort((left, right) =>
      right.daysSinceLastInteraction - left.daysSinceLastInteraction
      || right.totalInteracoes - left.totalInteracoes
      || left.ultimaInteracaoEm.localeCompare(right.ultimaInteracaoEm)
      || left.empresa.localeCompare(right.empresa, "pt")
      || left.contactoNome.localeCompare(right.contactoNome, "pt")
    );
}
