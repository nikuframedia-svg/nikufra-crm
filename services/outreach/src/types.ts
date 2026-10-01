export type OutreachRole = "viewer" | "sales_rep" | "campaign_manager";
export type Capability =
  | "outreach.read"
  | "outreach.thread.handle"
  | "outreach.thread.assign"
  | "outreach.campaign.manage"
  | "outreach.campaign.launch"
  | "outreach.mailbox.manage"
  | "outreach.suppression.manage"
  | "outreach.admin";

export interface Actor {
  id: string;
  email: string;
  name: string;
  crmRole: "admin" | "member";
  outreachRole: OutreachRole;
  capabilities: ReadonlySet<Capability>;
}

export type Provider = "google" | "microsoft" | "smtp";
export type SendMode = "disabled" | "canary" | "live";

export interface OAuthCredential {
  kind: "oauth";
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
  tokenType: string;
}

export interface SmtpCredential {
  kind: "smtp";
  smtp: { host: string; port: number; secure: boolean; username: string; password: string; rejectUnauthorized: boolean };
  imap: { host: string; port: number; secure: boolean; username: string; password: string; rejectUnauthorized: boolean } | null;
}

export type ProviderCredential = OAuthCredential | SmtpCredential;

export interface MailboxRecord {
  id: string;
  email: string;
  senderName: string;
  provider: Provider;
  status: string;
  sendEnabled: boolean;
  dailyLimit: number;
  sentToday: number;
  lastInboundSyncAt: Date | null;
}

export interface DeliveryEnvelope {
  jobId: string;
  recipientId: string;
  campaignId: string;
  mailboxId: string;
  fromEmail: string;
  senderName: string;
  to: string;
  subject: string;
  text: string;
  unsubscribeUrl: string;
  providerThreadId: string | null;
  inReplyTo: string | null;
  references: string[];
  idempotencyKey: string;
}

export interface ProviderReceipt {
  providerMessageId: string;
  providerThreadId: string | null;
  internetMessageId: string;
  acceptedAt: string;
}

export interface InboundProviderMessage {
  providerMessageId: string;
  providerThreadId: string | null;
  internetMessageId: string | null;
  inReplyTo: string | null;
  references: string[];
  from: string;
  subject: string;
  text: string;
  receivedAt: string;
  autoSubmitted: string | null;
  headers?: Record<string, string>;
}
