export type OutreachRole = "viewer" | "sales_rep" | "campaign_manager" | "admin";
export type OutreachCapability =
  | "outreach.read"
  | "outreach.thread.handle"
  | "outreach.thread.assign"
  | "outreach.campaign.manage"
  | "outreach.campaign.launch"
  | "outreach.mailbox.manage"
  | "outreach.suppression.manage"
  | "outreach.admin";
export type CampaignStatus = "draft" | "running" | "paused" | "completed" | "archived";
export type SendMode = "disabled" | "canary" | "live";

export interface PageInfo {
  page?: number;
  pageSize?: number;
  total?: number;
  nextCursor?: string | null;
}

export interface Collection<T> {
  items: T[];
  page?: PageInfo;
}

export interface OutreachOverview {
  campaignsTotal: number;
  campaignsRunning: number;
  sentToday: number;
  repliesTotal: number;
  positiveReplies: number;
  queuedJobs: number;
  readyMailboxes: number;
  dailyCapacity: number;
  sendMode: SendMode;
  outboundEnabled: boolean;
  nextJobs: Array<{ id: string; campaignName: string; contactName: string; dueAt: string }>;
  campaigns: CampaignSummary[];
}

export interface CampaignSummary {
  id: string;
  name: string;
  description?: string;
  status: CampaignStatus;
  recipientCount: number;
  sentCount: number;
  replyCount: number;
  positiveCount: number;
  bounceCount: number;
  progress: number;
  dailyLimit: number;
  updatedAt: string;
  launchedAt?: string | null;
}

export interface SequenceVariant {
  id: string;
  name: string;
  subject: string;
  body: string;
  weight: number;
  active: boolean;
}

export interface SequenceStep {
  id: string;
  order: number;
  kind: "email" | "wait";
  delayDays: number;
  delayHours: number;
  delayMinutes: number;
  replyToPrevious: boolean;
  active: boolean;
  variants: SequenceVariant[];
}

export interface CampaignRecipient {
  id: string;
  contactId: string | null;
  email: string | null;
  contactName: string | null;
  companyName: string | null;
  audienceId: string | null;
  audienceName: string | null;
  status: string;
  reasons: string[];
}

export interface CampaignMessageTest {
  id: string;
  createdAt: string;
  status: CampaignStatus;
  recipientEmail: string | null;
  mailboxEmail: string | null;
  sentCount: number;
  jobStatus: string | null;
  lastError: string | null;
}

export interface CampaignDetail extends CampaignSummary {
  mailboxIds: string[];
  availableMailboxes: Array<{
    id: string;
    email: string;
    displayName: string;
    provider: "google" | "microsoft" | "smtp";
    status: string;
    sendEnabled: boolean;
    dnsReady: boolean;
    dnsCheckedAt: string | null;
    ready: boolean;
    selected: boolean;
  }>;
  readiness: {
    ready: boolean;
    activeStepVariantCount: number;
    eligibleRecipientCount: number;
    selectedMailboxCount: number;
    readyMailboxCount: number;
  };
  audienceIds: string[];
  sequence: SequenceStep[];
  schedule: {
    timezone: string;
    days: number[];
    startTime: string;
    endTime: string;
  };
  settings: {
    stopOnReply: boolean;
    stopCompanyOnReply: boolean;
    includeUnsubscribe: boolean;
    trackOpens: boolean;
    trackClicks: boolean;
  };
  blockers: string[];
  warnings: string[];
}

export interface Audience {
  id: string;
  name: string;
  description?: string;
  contactCount: number;
  eligibleCount: number;
  createdAt: string;
}

export interface Eligibility {
  contactId: string;
  eligible: boolean;
  reasons: string[];
  verification: "valid" | "verified" | "risky" | "unknown" | "pending" | "invalid" | "catch_all";
  suppressed: boolean;
}

export interface Mailbox {
  id: string;
  email: string;
  senderName: string;
  provider: "google" | "microsoft" | "smtp";
  status: "ready" | "attention" | "paused" | "disconnected";
  healthScore: number;
  dailyLimit: number;
  sentToday: number;
  repliesToday: number;
  bounceRate: number;
  sendEnabled: boolean;
  lastSyncAt?: string | null;
  lastError?: string | null;
  authentication: { spf: boolean; dkim: boolean; dmarc: boolean };
}

export interface OutreachThread {
  id: string;
  subject: string;
  campaignId: string;
  campaignName: string;
  contactId: string;
  contactName: string;
  contactEmail: string;
  companyName: string;
  mailboxEmail: string;
  classification: "positive" | "question" | "objection" | "negative" | "auto_reply" | "unclassified";
  unread: boolean;
  archived: boolean;
  assignedTo?: string | null;
  lastMessageAt: string;
  preview: string;
}

export interface ThreadMessage {
  id: string;
  direction: "outbound" | "inbound";
  subject: string;
  body: string;
  occurredAt: string;
  status: string;
}

export interface ThreadDetail extends OutreachThread {
  messages: ThreadMessage[];
}

export interface Suppression {
  id: string;
  scope: "email" | "domain" | "company";
  value: string;
  reason: string;
  note?: string;
  createdAt: string;
}

export interface Deliverability {
  averageHealth: number;
  averageBounceRate: number;
  authenticatedMailboxes: number;
  totalMailboxes: number;
  availableCapacity: number;
  mailboxes: Mailbox[];
  suppressions: Suppression[];
  thresholds: { bounceWarning: number; bouncePause: number; complaintPause: number };
}

export interface OutreachSettings {
  adminOnly: boolean;
  role: OutreachRole;
  capabilities: OutreachCapability[];
  timezone: string;
  defaultDailyLimit: number;
  sendMode: SendMode;
  outboundEnabled: boolean;
  canaryAllowlist: string[];
  bounceWarningThreshold: number;
  bouncePauseThreshold: number;
  complaintPauseThreshold: number;
  trackingOpens: boolean;
  trackingClicks: boolean;
  members?: Array<{ id: string; name: string; email: string; role: OutreachRole }>;
}

export interface OutreachMetrics {
  days: number;
  daily: Array<{
    date: string;
    sent: number;
    replies: number;
    positiveReplies: number;
    hardBounces: number;
    complaints: number;
    unsubscribes: number;
  }>;
  totals: {
    sent: number;
    replies: number;
    positiveReplies: number;
    hardBounces: number;
    complaints: number;
    unsubscribes: number;
  };
}

export interface AuditEvent {
  id: string;
  actorName: string;
  action: string;
  entityType: string;
  summary: string;
  createdAt: string;
}

export interface ApiErrorBody {
  error?: { code?: string; message?: string; requestId?: string };
  message?: string;
}
