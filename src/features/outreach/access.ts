import type { OutreachCapability } from "./types";

export const adminOutreachCapabilities: OutreachCapability[] = [
  "outreach.read",
  "outreach.thread.handle",
  "outreach.thread.assign",
  "outreach.campaign.manage",
  "outreach.campaign.launch",
  "outreach.mailbox.manage",
  "outreach.suppression.manage",
  "outreach.admin",
];

export function canSeeOutreachNavigation(adminOnly: boolean, crmRole?: "admin" | "member") {
  return !adminOnly || crmRole === "admin";
}

export function hasOutreachCapability(capabilities: readonly string[], capability: OutreachCapability) {
  return capabilities.includes(capability);
}

export function requiredCapabilityForOutreachPath(pathname: string): OutreachCapability {
  if (pathname.startsWith("/outreach/respostas")) return "outreach.thread.handle";
  if (pathname.startsWith("/outreach/audiencias")) return "outreach.campaign.manage";
  if (pathname.startsWith("/outreach/mailboxes")) return "outreach.mailbox.manage";
  if (pathname.startsWith("/outreach/definicoes")) return "outreach.admin";
  return "outreach.read";
}

export function canAccessOutreachPath(pathname: string, capabilities: readonly string[]) {
  return hasOutreachCapability(capabilities, requiredCapabilityForOutreachPath(pathname));
}
