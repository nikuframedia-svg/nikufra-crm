import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { asCollection, deleteJson, outreachRequest, patchJson, postJson } from "./api";
import type {
  Audience,
  AuditEvent,
  CampaignDetail,
  CampaignRecipient,
  CampaignMessageTest,
  CampaignSummary,
  Collection,
  Eligibility,
  Mailbox,
  OutreachCapability,
  OutreachMetrics,
  OutreachOverview,
  OutreachSettings,
  OutreachThread,
  Suppression,
  ThreadDetail,
} from "./types";

export const outreachKeys = {
  all: ["outreach"] as const,
  overview: ["outreach", "overview"] as const,
  campaigns: ["outreach", "campaigns"] as const,
  campaign: (id: string) => ["outreach", "campaign", id] as const,
  campaignRecipients: (id: string) => ["outreach", "campaign", id, "recipients"] as const,
  campaignMessageTests: (id: string) => ["outreach", "campaign", id, "message-tests"] as const,
  messageTestContacts: (search: string) => ["outreach", "message-test-contacts", search] as const,
  audiences: ["outreach", "audiences"] as const,
  eligibility: (ids: string[]) => ["outreach", "eligibility", ...[...ids].sort()] as const,
  mailboxes: ["outreach", "mailboxes"] as const,
  threads: ["outreach", "threads"] as const,
  thread: (id: string) => ["outreach", "thread", id] as const,
  deliverability: ["outreach", "deliverability"] as const,
  settings: ["outreach", "settings"] as const,
};

function toCampaignSummary(input: Partial<CampaignSummary>): CampaignSummary {
  return {
    id: String(input.id ?? ""), name: String(input.name ?? "Campanha"), description: input.description ?? "",
    status: input.status ?? "draft", recipientCount: Number(input.recipientCount ?? 0), sentCount: Number(input.sentCount ?? 0),
    replyCount: Number(input.replyCount ?? 0), positiveCount: Number(input.positiveCount ?? 0), bounceCount: Number(input.bounceCount ?? 0),
    progress: Number(input.progress ?? 0), dailyLimit: Number(input.dailyLimit ?? 0), updatedAt: String(input.updatedAt ?? ""), launchedAt: input.launchedAt ?? null,
  };
}

type RawMailbox = Omit<Partial<Mailbox>, "status"> & { status?: Mailbox["status"] | "active" | "error" | "pending"; displayName?: string; dns?: { spf?: string; dkim?: string; dmarc?: string } | null };
function toMailbox(input: RawMailbox): Mailbox {
  const authentication = input.authentication ?? { spf: input.dns?.spf === "pass", dkim: input.dns?.dkim === "pass", dmarc: input.dns?.dmarc === "pass" };
  const status: Mailbox["status"] = input.status === "active" ? "ready" : input.status === "error" ? "attention" : input.status === "pending" ? "disconnected" : input.status ?? "disconnected";
  const dnsScore = [authentication.spf, authentication.dkim, authentication.dmarc].filter(Boolean).length * 10;
  return {
    id: String(input.id ?? ""), email: String(input.email ?? ""), senderName: String(input.senderName ?? input.displayName ?? input.email ?? "Mailbox"),
    provider: input.provider ?? "google", status, healthScore: Number(input.healthScore ?? (status === "ready" ? 70 + dnsScore : dnsScore)),
    dailyLimit: Number(input.dailyLimit ?? 0), sentToday: Number(input.sentToday ?? 0), repliesToday: Number(input.repliesToday ?? 0),
    bounceRate: Number(input.bounceRate ?? 0), sendEnabled: Boolean(input.sendEnabled), lastSyncAt: input.lastSyncAt ?? null,
    lastError: input.lastError ?? null, authentication,
  };
}

function toThread(input: Partial<OutreachThread> & { snippet?: string; status?: string }): OutreachThread {
  return {
    id: String(input.id ?? ""), subject: String(input.subject ?? "Sem assunto"), campaignId: String(input.campaignId ?? ""), campaignName: String(input.campaignName ?? "Campanha"),
    contactId: String(input.contactId ?? ""), contactName: String(input.contactName ?? "Contacto"), contactEmail: String(input.contactEmail ?? ""),
    companyName: String(input.companyName ?? ""), mailboxEmail: String(input.mailboxEmail ?? ""), classification: input.classification ?? "unclassified",
    unread: Boolean(input.unread), archived: input.archived ?? input.status === "archived", assignedTo: input.assignedTo ?? null,
    lastMessageAt: String(input.lastMessageAt ?? ""), preview: String(input.preview ?? input.snippet ?? ""),
  };
}

export function useOverview() {
  return useQuery({ queryKey: outreachKeys.overview, queryFn: async () => {
    const [overview, campaignsRaw] = await Promise.all([
      outreachRequest<Partial<OutreachOverview>>("/overview"),
      outreachRequest<Collection<CampaignSummary> | CampaignSummary[]>("/campaigns?pageSize=8"),
    ]);
    const campaigns = asCollection(campaignsRaw).items.map(toCampaignSummary);
    return {
      campaignsTotal: Number(overview.campaignsTotal ?? campaigns.length), campaignsRunning: Number(overview.campaignsRunning ?? campaigns.filter((item) => item.status === "running").length),
      sentToday: Number(overview.sentToday ?? 0), repliesTotal: Number(overview.repliesTotal ?? 0), positiveReplies: Number(overview.positiveReplies ?? 0),
      queuedJobs: Number(overview.queuedJobs ?? 0), readyMailboxes: Number(overview.readyMailboxes ?? 0),
      dailyCapacity: Number(overview.dailyCapacity ?? 0),
      sendMode: overview.sendMode ?? "disabled", outboundEnabled: Boolean(overview.outboundEnabled), nextJobs: overview.nextJobs ?? [], campaigns,
    } satisfies OutreachOverview;
  } });
}

export function useCampaigns(page = 1, pageSize = 100, search = "") {
  return useQuery({ queryKey: [...outreachKeys.campaigns, page, pageSize, search], queryFn: async () => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (search.trim()) params.set("search", search.trim());
    const result = asCollection(await outreachRequest<Collection<CampaignSummary> | CampaignSummary[]>(`/campaigns?${params}`));
    return { ...result, items: result.items.map(toCampaignSummary) };
  } });
}

export function useCampaign(id: string) {
  return useQuery({ queryKey: outreachKeys.campaign(id), queryFn: async () => {
    type RawStep = { id: string; position: number; kind?: "email" | "wait"; delayMinutes: number; replyToPrevious?: boolean; active?: boolean; variants?: Array<Partial<CampaignDetail["sequence"][number]["variants"][number]> & { id: string; name: string; subject: string; body: string; weight: number }> };
    type RawDetail = Partial<CampaignDetail> & { steps?: RawStep[]; recipientCounts?: Array<{ status: string; count: number }>; stopCompanyOnReply?: boolean; sendDays?: number[]; sendWindowStart?: string; sendWindowEnd?: string };
    const raw = await outreachRequest<RawDetail>(`/campaigns/${encodeURIComponent(id)}`);
    const counts = raw.recipientCounts ?? [];
    const recipientCount = raw.recipientCount ?? counts.reduce((sum, item) => sum + Number(item.count), 0);
    const sequence = raw.sequence ?? (raw.steps ?? []).map((step) => ({ id: step.id, order: step.position, kind: step.kind ?? "email", delayMinutes: Number(step.delayMinutes || 0), delayDays: Math.floor(Number(step.delayMinutes || 0) / 1_440), delayHours: Math.floor((Number(step.delayMinutes || 0) % 1_440) / 60), replyToPrevious: step.replyToPrevious ?? true, active: step.active ?? true, variants: (step.variants ?? []).map((variant) => ({ ...variant, active: variant.active ?? true })) }));
    const mailboxIds = raw.mailboxIds ?? [];
    const blockers = raw.blockers ?? [...(!sequence.length ? ["Adiciona pelo menos um passo à sequência."] : []), ...(!recipientCount ? ["Adiciona uma audiência com contactos elegíveis."] : []), ...(!mailboxIds.length ? ["Seleciona pelo menos uma mailbox para a campanha."] : [])];
    return {
      ...toCampaignSummary({ ...raw, recipientCount }), mailboxIds, availableMailboxes: raw.availableMailboxes ?? [], audienceIds: raw.audienceIds ?? [], sequence,
      readiness: raw.readiness ?? { ready: blockers.length === 0, activeStepVariantCount: sequence.length, eligibleRecipientCount: recipientCount, selectedMailboxCount: mailboxIds.length, readyMailboxCount: 0 },
      schedule: raw.schedule ?? { timezone: "Europe/Lisbon", days: raw.sendDays ?? [1,2,3,4,5], startTime: raw.sendWindowStart ?? "09:00", endTime: raw.sendWindowEnd ?? "17:00" },
      settings: raw.settings ?? { stopOnReply: true, stopCompanyOnReply: raw.stopCompanyOnReply ?? true, includeUnsubscribe: true, trackOpens: false, trackClicks: false },
      blockers, warnings: raw.warnings ?? [],
    } satisfies CampaignDetail;
  }, enabled: Boolean(id) });
}

export function useCreateCampaign() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: (input: { name: string; description: string; dailyLimit: number; audienceId?: string; steps: Array<{ delayMinutes: number; replyToPrevious: boolean; variants: Array<{ name: string; weight: number; subject: string; body: string }> }> }) => postJson<CampaignDetail>("/campaigns", input), onSuccess: () => void queryClient.invalidateQueries({ queryKey: outreachKeys.all }) });
}

export function useCampaignAction(id: string) {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: (action: "launch" | "pause" | "resume") => postJson<CampaignDetail>(`/campaigns/${encodeURIComponent(id)}/${action}`), onSuccess: () => void queryClient.invalidateQueries({ queryKey: outreachKeys.all }) });
}

export function useSetCampaignMailboxes(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (mailboxIds: string[]) => patchJson<{ id: string; mailboxIds: string[] }>(`/campaigns/${encodeURIComponent(id)}`, { mailboxIds }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: outreachKeys.campaign(id) }),
  });
}

export interface CampaignStepDraft {
  kind: "email" | "wait";
  delayMinutes: number;
  replyToPrevious: boolean;
  active: boolean;
  variants: Array<{ name: string; weight: number; subject: string; body: string; active: boolean }>;
}

export function useSaveCampaignSteps(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (steps: CampaignStepDraft[]) => patchJson<{ id: string }>(`/campaigns/${encodeURIComponent(id)}`, { steps }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: outreachKeys.campaign(id) }); void queryClient.invalidateQueries({ queryKey: outreachKeys.campaigns }); },
  });
}

export function useCampaignRecipients(id: string, page = 1, enabled = true) {
  return useQuery({
    queryKey: [...outreachKeys.campaignRecipients(id), page],
    queryFn: () => outreachRequest<Collection<CampaignRecipient>>(`/campaigns/${encodeURIComponent(id)}/recipients?page=${page}&pageSize=25`),
    enabled: Boolean(id) && enabled,
  });
}

export function useQueueCampaignMessageTest(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ idempotencyKey, ...input }: { stepId: string; variantId: string; contactId: string; mailboxId: string; idempotencyKey: string }) => outreachRequest<{ id: string; queued: boolean; duplicate: boolean }>(`/campaigns/${encodeURIComponent(id)}/message-tests`, { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(input) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: outreachKeys.campaignMessageTests(id) }),
  });
}

export function useCampaignMessageTests(id: string, enabled = true) {
  return useQuery({
    queryKey: outreachKeys.campaignMessageTests(id),
    queryFn: () => outreachRequest<Collection<CampaignMessageTest>>(`/campaigns/${encodeURIComponent(id)}/message-tests`),
    enabled: Boolean(id) && enabled,
    refetchInterval: 30_000,
  });
}

export interface MessageTestContact { id: string; name: string; email: string; companyName: string }

export function useMessageTestContacts(search: string, enabled = true) {
  return useQuery({
    queryKey: outreachKeys.messageTestContacts(search),
    queryFn: () => outreachRequest<Collection<MessageTestContact>>(`/message-test-contacts?search=${encodeURIComponent(search)}`),
    enabled,
    staleTime: 30_000,
  });
}

export function useAudiences(enabled = true) {
  return useQuery({ queryKey: outreachKeys.audiences, queryFn: async () => { const result = asCollection(await outreachRequest<Collection<Audience & { memberCount?: number }> | Array<Audience & { memberCount?: number }>>("/audiences?pageSize=100")); return { ...result, items: result.items.map((item) => ({ ...item, contactCount: Number(item.contactCount ?? item.memberCount ?? 0), eligibleCount: Number(item.eligibleCount ?? 0) })) }; }, enabled });
}

export function useEligibility(ids: string[]) {
  return useQuery({
    queryKey: outreachKeys.eligibility(ids),
    queryFn: async () => {
      const chunks: string[][] = [];
      for (let index = 0; index < ids.length; index += 75) chunks.push(ids.slice(index, index + 75));
      const items: Eligibility[] = [];
      for (let index = 0; index < chunks.length; index += 5) {
        const batch = await Promise.all(chunks.slice(index, index + 5).map(async (chunk) => asCollection(await outreachRequest<Collection<Eligibility> | Eligibility[]>(`/audiences/eligibility?ids=${encodeURIComponent(chunk.join(","))}`))));
        batch.forEach((collection) => items.push(...collection.items));
      }
      return { items } satisfies Collection<Eligibility>;
    },
    enabled: ids.length > 0,
    staleTime: 60_000,
  });
}

export interface LeadVerificationResult {
  contactId: string;
  email: string | null;
  status: "valid" | "risky" | "invalid" | "unknown" | "exempt";
  reason: string;
}

export function useVerifyLeads() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (contactIds: string[]) => {
      const items: LeadVerificationResult[] = [];
      for (let index = 0; index < contactIds.length; index += 25) {
        const result = await postJson<{ items: LeadVerificationResult[] }>("/verifications", {
          contactIds: contactIds.slice(index, index + 25),
        });
        items.push(...result.items);
      }
      return { items };
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: outreachKeys.all }),
  });
}

export function useCreateAudience() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: ({ contactIds: _contactIds, ...input }: { name: string; description?: string; contactIds: string[] }) => postJson<Audience>("/audiences", input), onSuccess: () => void queryClient.invalidateQueries({ queryKey: outreachKeys.audiences }) });
}

export function useAddRecipients() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: (input: { audienceId: string; contactIds: string[] }) => postJson<{ added: number; skipped: number }>(`/audiences/${encodeURIComponent(input.audienceId)}/recipients`, { contactIds: input.contactIds }), onSuccess: () => void queryClient.invalidateQueries({ queryKey: outreachKeys.audiences }) });
}

export function useAttachAudienceToCampaign() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: ({ campaignId, audienceId }: { campaignId: string; audienceId: string }) => patchJson<CampaignDetail>(`/campaigns/${encodeURIComponent(campaignId)}`, { addAudienceId: audienceId }), onSuccess: (_data, variables) => { void queryClient.invalidateQueries({ queryKey: outreachKeys.campaign(variables.campaignId) }); void queryClient.invalidateQueries({ queryKey: outreachKeys.campaigns }); } });
}

export function useMailboxes(enabled = true) {
  return useQuery({ queryKey: outreachKeys.mailboxes, queryFn: async () => { const result = asCollection(await outreachRequest<Collection<Mailbox> | Mailbox[]>("/mailboxes")); return { ...result, items: result.items.map((item) => toMailbox(item as RawMailbox)) }; }, enabled });
}

export function useMailboxAction() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: ({ id, action }: { id: string; action: "test" | "dns" }) => postJson<Mailbox>(`/mailboxes/${encodeURIComponent(id)}/${action}`, {}), onSuccess: () => {
    void queryClient.invalidateQueries({ queryKey: outreachKeys.mailboxes });
    void queryClient.invalidateQueries({ queryKey: ["outreach", "campaign"] });
  } });
}

export function useStartMailboxOAuth() {
  return useMutation({ mutationFn: (input: { mailboxId: string; provider: "google"; emailHint?: string }) => postJson<{ authorizationUrl: string }>("/mailboxes/oauth/start", input), onSuccess: ({ authorizationUrl }) => { window.location.assign(authorizationUrl); } });
}

export function useCreateMailbox() {
  return useMutation({ mutationFn: (input: { provider: "google"; email: string; displayName: string; dailyLimit: number; timezone: string }) => postJson<{ id: string }>("/mailboxes", input) });
}

export function useThreads(page = 1, pageSize = 25) {
  return useQuery({ queryKey: [...outreachKeys.threads, page, pageSize], queryFn: async () => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    const result = asCollection(await outreachRequest<Collection<OutreachThread> | OutreachThread[]>(`/threads?${params}`));
    return { ...result, items: result.items.map((item) => toThread(item)) };
  }, refetchInterval: 30_000 });
}

export function useThread(id: string) {
  return useQuery({ queryKey: outreachKeys.thread(id), queryFn: async () => {
    type RawMessage = ThreadDetail["messages"][number] & { kind?: string };
    const result = await outreachRequest<Omit<ThreadDetail, "messages"> & { messages?: RawMessage[] }>(`/threads/${encodeURIComponent(id)}`);
    return { ...toThread(result), messages: (result.messages ?? []).map((message) => ({ ...message, status: message.status ?? message.kind ?? (message.direction === "inbound" ? "recebida" : "enviada") })) } satisfies ThreadDetail;
  }, enabled: Boolean(id) });
}

export function useThreadAction(id: string) {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: ({ action, payload }: { action: "reply" | "classify" | "archive" | "assign"; payload?: unknown }) => action === "reply"
    ? outreachRequest<ThreadDetail>(`/threads/${encodeURIComponent(id)}/reply`, { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify(payload ?? {}) })
    : postJson<ThreadDetail>(`/threads/${encodeURIComponent(id)}/${action}`, payload ?? {}), onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: outreachKeys.threads });
      void queryClient.invalidateQueries({ queryKey: outreachKeys.thread(id) });
    } });
}

export function useMetrics(days = 30) {
  return useQuery({ queryKey: [...outreachKeys.deliverability, days], queryFn: async () => {
    const raw = await outreachRequest<Partial<OutreachMetrics>>(`/metrics?days=${days}`);
    const total: Partial<OutreachMetrics["totals"]> = raw.totals ?? {};
    return {
      days: Number(raw.days ?? days),
      daily: raw.daily ?? [],
      totals: {
        sent: Number(total.sent ?? 0), replies: Number(total.replies ?? 0), positiveReplies: Number(total.positiveReplies ?? 0),
        hardBounces: Number(total.hardBounces ?? 0), complaints: Number(total.complaints ?? 0), unsubscribes: Number(total.unsubscribes ?? 0),
      },
    } satisfies OutreachMetrics;
  } });
}

export function useSuppressions(enabled = true) {
  return useQuery({ queryKey: [...outreachKeys.deliverability, "suppressions"], queryFn: async () => { const result = asCollection(await outreachRequest<Collection<Suppression & { email?: string; domain?: string; companyId?: string }> | Array<Suppression & { email?: string; domain?: string; companyId?: string }>>("/suppressions")); return { ...result, items: result.items.map((item) => ({ ...item, value: item.value ?? item.email ?? item.domain ?? item.companyId ?? "—" })) }; }, enabled });
}

export function useDeleteSuppression() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: (id: string) => deleteJson<void>(`/suppressions/${encodeURIComponent(id)}`), onSuccess: () => void queryClient.invalidateQueries({ queryKey: outreachKeys.deliverability }) });
}

export function useCreateSuppression() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { scope: "email"; email: string; reason: "manual" | "legal"; note: string } | { scope: "domain"; domain: string; reason: "manual" | "legal"; note: string }) => postJson<{ id: string }>("/suppressions", input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: outreachKeys.deliverability }),
  });
}

export function useSettings(enabled = true) {
  return useQuery({ queryKey: outreachKeys.settings, queryFn: async () => {
    type RawMember = { id: string; name: string; email: string; role?: OutreachSettings["role"] | null; crmRole?: "admin" | "member" };
    type RawSettings = Omit<Partial<OutreachSettings>, "members"> & { mode?: OutreachSettings["sendMode"]; sendEnabled?: boolean; outboundEnvEnabled?: boolean; members?: RawMember[]; actor?: { role?: "admin" | "member"; outreachRole?: Exclude<OutreachSettings["role"], "admin">; capabilities?: OutreachCapability[] } | null };
    const raw = await outreachRequest<RawSettings>("/settings");
    const role = raw.role ?? (raw.actor?.role === "admin" ? "admin" : raw.actor?.outreachRole) ?? (raw.members?.length ? "admin" : "viewer");
    const capabilities: OutreachCapability[] = raw.capabilities ?? raw.actor?.capabilities ?? (role === "admin" ? ["outreach.read", "outreach.campaign.manage", "outreach.campaign.launch", "outreach.thread.handle", "outreach.thread.assign", "outreach.mailbox.manage", "outreach.suppression.manage", "outreach.admin"] : ["outreach.read"]);
    const members = (raw.members ?? []).map((member) => ({ ...member, role: member.crmRole === "admin" ? "admin" as const : member.role ?? "viewer" as const }));
    return { adminOnly: raw.adminOnly ?? true, role, capabilities, timezone: raw.timezone ?? "Europe/Lisbon", defaultDailyLimit: Number(raw.defaultDailyLimit ?? 10), sendMode: raw.sendMode ?? raw.mode ?? "disabled", outboundEnabled: Boolean(raw.outboundEnabled ?? (raw.outboundEnvEnabled && raw.sendEnabled)), canaryAllowlist: raw.canaryAllowlist ?? [], bounceWarningThreshold: Number(raw.bounceWarningThreshold ?? 2), bouncePauseThreshold: Number(raw.bouncePauseThreshold ?? 5), complaintPauseThreshold: Number(raw.complaintPauseThreshold ?? .1), trackingOpens: Boolean(raw.trackingOpens), trackingClicks: Boolean(raw.trackingClicks), members } satisfies OutreachSettings;
  }, enabled });
}

export function useAudit() {
  return useQuery({ queryKey: ["outreach", "audit"], queryFn: async () => asCollection(await outreachRequest<Collection<AuditEvent> | AuditEvent[]>("/audit")) });
}

export function useSaveSettings() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: (input: Partial<OutreachSettings>) => patchJson<Partial<OutreachSettings>>("/settings", input), onSuccess: () => void queryClient.invalidateQueries({ queryKey: outreachKeys.settings }) });
}

export function useUpdateOutreachRole() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: (input: { profileId: string; outreachRole: "viewer" | "sales_rep" | "campaign_manager" }) => patchJson<OutreachSettings>("/settings", input), onSuccess: () => void queryClient.invalidateQueries({ queryKey: outreachKeys.settings }) });
}
