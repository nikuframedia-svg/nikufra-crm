import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const campaign = {
  id: "campaign-1",
  name: "Indústria Norte",
  description: "Primeiro contacto com fabricantes portugueses.",
  status: "draft",
  recipientCount: 14,
  sentCount: 4,
  replyCount: 2,
  positiveCount: 1,
  bounceCount: 0,
  progress: 29,
  dailyLimit: 10,
  updatedAt: "2026-09-30T14:00:00Z",
};

const mailbox = {
  id: "mailbox-1",
  provider: "google",
  email: "mia@nikufra.ai",
  displayName: "Mia · Nikufra",
  status: "active",
  sendEnabled: false,
  dailyLimit: 10,
  sentToday: 0,
  lastSyncAt: "2026-09-30T14:00:00Z",
  lastError: null,
  dns: { spf: "pass", dkim: "pass", dmarc: "pass" },
};

const thread = {
  id: "thread-1",
  subject: "Re: uma hipótese concreta",
  status: "open",
  classification: "positive",
  unread: true,
  assignedTo: null,
  lastMessageAt: "2026-09-30T14:10:00Z",
  contactName: "Ana Silva",
  contactEmail: "ana@example.com",
  companyName: "Fábrica Exemplo",
  mailboxEmail: "mia@nikufra.ai",
  snippet: "Podemos falar na próxima semana.",
};
const secondCampaign = { ...campaign, id: "campaign-2", name: "Indústria Sul" };
const secondThread = { ...thread, id: "thread-2", subject: "Re: segunda conversa", contactName: "Bruno Costa" };

const capabilities = [
  "outreach.read",
  "outreach.thread.handle",
  "outreach.thread.assign",
  "outreach.campaign.manage",
  "outreach.campaign.launch",
  "outreach.mailbox.manage",
  "outreach.suppression.manage",
  "outreach.admin",
];

async function mockOutreachApi(page: Page, testReady = false, verification: "valid" | "unknown" = "valid", staleDns = false) {
  let selectedMailboxIds: string[] = testReady ? [mailbox.id] : [];
  let dnsReady = testReady && !staleDns;
  let audienceIds: string[] = [];
  let messageTests: Array<{ id: string; createdAt: string; status: string; recipientEmail: string; mailboxEmail: string; sentCount: number; jobStatus: string; lastError: null }> = [];
  let campaignSteps = [{ id: "step-1", position: 1, kind: "email", delayMinutes: 0, replyToPrevious: true, active: true, variants: [{ id: "variant-1", name: "A", weight: 100, subject: "{{empresa}} × Nikufra", body: "Olá {{nome}}", active: true }] }];
  await page.route("**/api/outreach/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/outreach/v1", "");
    let data: unknown = {};

    if (path === "/overview") data = { campaignsTotal: 1, campaignsRunning: 0, sentToday: 4, repliesTotal: 2, positiveReplies: 1, queuedJobs: 3, sendMode: "disabled", outboundEnabled: false };
    else if (path === "/campaigns" && request.method() === "POST") data = { id: "campaign-3" };
    else if (path === "/campaigns") data = { items: [url.searchParams.get("page") === "2" ? secondCampaign : campaign], page: { page: Number(url.searchParams.get("page") ?? 1), pageSize: Number(url.searchParams.get("pageSize") ?? 25), total: 26 } };
    else if (path === "/campaigns/campaign-1" && request.method() === "PATCH") {
      const input = request.postDataJSON() as { mailboxIds?: string[]; addAudienceId?: string; steps?: typeof campaignSteps };
      if (input.mailboxIds) selectedMailboxIds = input.mailboxIds;
      if (input.addAudienceId) audienceIds = [...audienceIds, input.addAudienceId];
      if (input.steps) campaignSteps = input.steps.map((step, index) => ({ ...step, id: `step-${index + 1}`, position: index + 1, variants: step.variants.map((variant, variantIndex) => ({ ...variant, id: `variant-${index + 1}-${variantIndex + 1}` })) }));
      data = { id: campaign.id, mailboxIds: selectedMailboxIds };
    }
    else if (path === "/campaigns/campaign-1/message-tests" && request.method() === "POST") { messageTests = [{ id: "test-campaign-1", createdAt: new Date().toISOString(), status: "running", recipientEmail: "contacto@example.invalid", mailboxEmail: mailbox.email, sentCount: 0, jobStatus: "pending", lastError: null }]; data = { id: "test-campaign-1", queued: true, duplicate: false }; }
    else if (path === "/campaigns/campaign-1/message-tests") data = { items: messageTests };
    else if (path === "/message-test-contacts") data = { items: !url.searchParams.get("search") || "Contacto de Teste contacto@example.invalid Empresa de Teste".toLowerCase().includes((url.searchParams.get("search") ?? "").toLowerCase()) ? [{ id: "44444444-4444-4444-8444-444444444444", name: "Contacto de Teste", email: "contacto@example.invalid", companyName: "Empresa de Teste" }] : [] };
    else if (path === "/campaigns/campaign-1/recipients") data = { items: [], page: { page: 1, pageSize: 25, total: 0 } };
    else if (path === "/campaigns/campaign-3/recipients") data = { items: [], page: { page: 1, pageSize: 25, total: 0 } };
    else if (path === "/campaigns/campaign-3") data = { ...campaign, id: "campaign-3", name: "Nova campanha", recipientCount: 0, mailboxIds: [], audienceIds: [], availableMailboxes: [], steps: [], recipientCounts: [], readiness: { ready: false, activeStepVariantCount: 0, eligibleRecipientCount: 0, selectedMailboxCount: 0, readyMailboxCount: 0 }, blockers: ["Seleciona destinatários e mailbox."] };
    else if (path === "/campaigns/campaign-1") data = { ...campaign, audienceIds, mailboxIds: selectedMailboxIds, availableMailboxes: [{ id: mailbox.id, email: mailbox.email, displayName: mailbox.displayName, provider: mailbox.provider, status: mailbox.status, sendEnabled: testReady, dnsReady, dnsCheckedAt: "2026-09-30T14:00:00Z", ready: dnsReady, selected: selectedMailboxIds.includes(mailbox.id) }], readiness: { ready: false, activeStepVariantCount: campaignSteps.length, eligibleRecipientCount: 14, selectedMailboxCount: selectedMailboxIds.length, readyMailboxCount: dnsReady ? selectedMailboxIds.length : 0 }, blockers: selectedMailboxIds.length ? ["A mailbox selecionada ainda não está pronta."] : ["Seleciona pelo menos uma mailbox para a campanha."], steps: campaignSteps, recipientCounts: [{ status: "eligible", count: 14 }], stopCompanyOnReply: true, sendDays: [1, 2, 3, 4, 5], sendWindowStart: "09:00", sendWindowEnd: "17:00" };
    else if (path === "/audiences") data = { items: [{ id: "audience-1", name: "Fabricantes", description: "Contactos CRM", memberCount: 14, eligibleCount: 12, createdAt: "2026-09-29T10:00:00Z" }] };
    else if (path === "/audiences/eligibility") data = { items: (url.searchParams.get("ids") ?? "").split(",").filter(Boolean).map((contactId) => ({ contactId, eligible: verification === "valid", reasons: verification === "valid" ? [] : ["verification_missing"], verification, suppressed: false })) };
    else if (path === "/mailboxes") data = { items: [mailbox] };
    else if (path === `/mailboxes/${mailbox.id}/dns` && request.method() === "POST") { dnsReady = true; data = { spf: { status: "pass" }, dkim: { status: "pass" }, dmarc: { status: "pass" }, mx: { status: "pass" } }; }
    else if (path === "/threads") data = { items: [url.searchParams.get("page") === "2" ? secondThread : thread], page: { page: Number(url.searchParams.get("page") ?? 1), pageSize: Number(url.searchParams.get("pageSize") ?? 25), total: 26 } };
    else if (path === "/threads/thread-1") data = { ...thread, messages: [{ id: "message-1", direction: "inbound", subject: thread.subject, body: "Podemos falar na próxima semana?", occurredAt: thread.lastMessageAt, status: "received" }] };
    else if (path === "/threads/thread-2") data = { ...secondThread, messages: [{ id: "message-2", direction: "inbound", subject: secondThread.subject, body: "Podemos falar amanhã?", occurredAt: secondThread.lastMessageAt, status: "received" }] };
    else if (path === "/suppressions") data = { items: [{ id: "suppression-1", scope: "email", email: "blocked@example.com", reason: "manual", note: "Pedido comercial", createdAt: "2026-09-28T09:00:00Z" }] };
    else if (path === "/settings") data = { adminOnly: false, mode: testReady ? "live" : "disabled", sendEnabled: testReady, outboundEnvEnabled: testReady, actor: { role: "admin", outreachRole: "viewer", capabilities }, members: [{ id: "member-1", name: "João", email: "joao@nikufra.ai", role: "admin" }] };
    else if (path === "/audit") data = { items: [{ id: "audit-1", actorName: "João", action: "campaign.created", entityType: "campaign", summary: "Campanha criada", createdAt: "2026-09-30T12:00:00Z" }] };
    else if (path === "/metrics") data = { days: 30, daily: [], totals: {} };

    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data }) });
  });
}

async function openRoute(page: Page, path: string, theme: "light" | "dark" = "light", testReady = false, verification: "valid" | "unknown" = "valid", staleDns = false) {
  await page.addInitScript((selectedTheme) => {
    localStorage.setItem("nikufra:theme", selectedTheme);
    localStorage.setItem("nikufra:v2:leads", JSON.stringify([{
      id: "11111111-1111-4111-8111-111111111111",
      empresaId: "22222222-2222-4222-8222-222222222222",
      nome: "Contacto de Teste",
      cargo: "Direção de Operações",
      empresa: "Empresa de Teste",
      email: "contacto@example.invalid",
      telefone: "",
      vertical: "Outro",
      cidade: "Lisboa",
      pais: "PT",
      origem: "e2e",
      estado: "contactado",
      ownerId: "unassigned",
      optout: false,
    }]));
    localStorage.setItem("nikufra:v2:opportunities", JSON.stringify([{
      id: "33333333-3333-4333-8333-333333333333",
      leadId: "11111111-1111-4111-8111-111111111111",
      empresaId: "22222222-2222-4222-8222-222222222222",
      empresa: "Empresa de Teste",
      titulo: "Relação comercial",
      estado: "contactado",
      tipo: "Consultoria",
      valor: 1000,
      probabilidade: 5,
      ownerId: "unassigned",
      diasNoEstado: 2,
      dataPrimeiroContacto: "2026-09-28",
      dataFechoPrevista: "2026-12-01",
    }]));
  }, theme);
  await mockOutreachApi(page, testReady, verification, staleDns);
  await page.goto(path);
  await expect(page.locator(".outreach-module")).toBeVisible();
  await expect(page.locator(".outreach-loading")).toHaveCount(0);
}

async function expectNoCriticalAccessibilityViolations(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const summary = result.violations.map((violation) => ({
    id: violation.id,
    help: violation.help,
    targets: violation.nodes.map((node) => node.target.join(" ")),
  }));
  expect(summary, summary.map((violation) => `${violation.id}: ${violation.targets.join(", ")}`).join("\n")).toEqual([]);
}

const routes = [
  "/outreach",
  "/outreach/campanhas",
  "/outreach/campanhas/campaign-1",
  "/outreach/respostas",
  "/outreach/audiencias",
  "/outreach/mailboxes",
  "/outreach/deliverability",
  "/outreach/definicoes",
] as const;

for (const path of routes) {
  test(`${path} renders without overflow and meets automated WCAG 2.2 AA`, async ({ page }) => {
    await openRoute(page, path);
    const overflow = await page.evaluate(() => {
      const viewport = document.documentElement.clientWidth;
      const offenders = [...document.querySelectorAll<HTMLElement>("body *")]
        .map((element) => ({ element, rect: element.getBoundingClientRect() }))
        .filter(({ rect }) => rect.right > viewport + 1)
        .slice(0, 8)
        .map(({ element, rect }) => ({ selector: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${[...element.classList].map((name) => `.${name}`).join("")}`, left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) }));
      return { viewport, content: document.documentElement.scrollWidth, offenders };
    });
    expect(overflow.content, `horizontal page overflow: ${overflow.content}px > ${overflow.viewport}px\n${JSON.stringify(overflow.offenders, null, 2)}`).toBeLessThanOrEqual(overflow.viewport + 1);
    await expectNoCriticalAccessibilityViolations(page);
  });
}

test("an inconclusive contact can join an audience only after confirmation", async ({ page }) => {
  await openRoute(page, "/outreach/audiencias", "light", false, "unknown");
  const contact = page.getByRole("checkbox", { name: "Adicionar Contacto de Teste a audiência" });
  await expect(contact).toBeEnabled();
  await contact.check();
  await page.getByRole("button", { name: "Adicionar 1 a audiência ou campanha" }).click();
  await page.getByRole("button", { name: "Adicionar contactos", exact: true }).click();

  const confirmation = page.getByRole("dialog", { name: "Tem a certeza?" });
  await expect(confirmation).toContainText("1 dos 1 contactos selecionados têm verificação inconclusiva ou pendente");
  await expectNoCriticalAccessibilityViolations(page);
  await confirmation.getByRole("button", { name: "Voltar" }).click();
  await expect(page.getByRole("dialog", { name: "Adicionar contactos" })).toBeVisible();

  await page.getByRole("button", { name: "Adicionar contactos", exact: true }).click();
  const requestPromise = page.waitForRequest((request) => request.method() === "POST" && request.url().endsWith("/audiences/audience-1/recipients"));
  await page.getByRole("dialog", { name: "Tem a certeza?" }).getByRole("button", { name: "Confirmar e adicionar" }).click();
  expect((await requestPromise).postDataJSON()).toEqual({ contactIds: ["11111111-1111-4111-8111-111111111111"] });
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("light and dark themes remain accessible", async ({ page }) => {
  await openRoute(page, "/outreach", "light");
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await expectNoCriticalAccessibilityViolations(page);
  await page.getByRole("button", { name: "Alternar tema" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expectNoCriticalAccessibilityViolations(page);
});

test("mobile drawer traps focus, closes with Escape and restores focus", async ({ page, viewport }) => {
  test.skip(viewport?.width !== 390, "Drawer behavior is exercised at the mobile acceptance viewport.");
  await openRoute(page, "/outreach");
  const opener = page.getByRole("button", { name: "Abrir menu" });
  await opener.focus();
  await opener.click();
  const sidebar = page.locator("#main-navigation");
  await expect(opener).toHaveAttribute("aria-expanded", "true");
  await expect(sidebar).toHaveClass(/sidebar--open/);
  for (let index = 0; index < 16; index += 1) {
    await page.keyboard.press("Tab");
    expect(await sidebar.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(opener).toHaveAttribute("aria-expanded", "false");
  await expect(opener).toBeFocused();
});

test("an Outreach API outage stays inside the module", async ({ page }) => {
  await page.route("**/api/outreach/v1/**", (route) => route.abort("connectionrefused"));
  await page.goto("/outreach");
  await expect(page.getByRole("alert")).toContainText("Outreach está temporariamente indisponível");
  await expect(page.getByRole("link", { name: "Pipeline" })).toBeVisible();
});

test("campaigns and replies request the next API page", async ({ page }) => {
  await openRoute(page, "/outreach/campanhas");
  await expect(page.getByRole("link", { name: /Indústria Norte/ })).toBeVisible();
  await page.getByRole("navigation", { name: "Páginas de Outreach" }).getByRole("button", { name: "Seguinte" }).click();
  await expect(page.getByRole("link", { name: /Indústria Sul/ })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Páginas de Outreach" })).toContainText("Página 2 de 2");

  await page.goto("/outreach/respostas");
  await expect(page.locator(".outreach-inbox-list")).toContainText("Ana Silva");
  await page.getByRole("navigation", { name: "Páginas de Outreach" }).getByRole("button", { name: "Seguinte" }).click();
  await expect(page.locator(".outreach-inbox-list")).toContainText("Bruno Costa");
});

test("mobile inbox starts on the list and back stays on the list", async ({ page, viewport }) => {
  test.skip(viewport?.width !== 390, "Mobile inbox behavior is exercised at the mobile acceptance viewport.");
  await openRoute(page, "/outreach/respostas");
  const list = page.locator(".outreach-inbox-list");
  await expect(list).toBeVisible();
  await page.getByRole("button", { name: /Ana Silva/ }).click();
  await expect(list).toBeHidden();
  await page.getByRole("button", { name: "Voltar à lista" }).click();
  await expect(list).toBeVisible();
  await page.getByRole("navigation", { name: "Páginas de Outreach" }).getByRole("button", { name: "Seguinte" }).click();
  await expect(list).toContainText("Bruno Costa");
});

test("campaign mailbox selection saves the exact selected ids", async ({ page }) => {
  await openRoute(page, "/outreach/campanhas/campaign-1");
  const mailboxes = page.locator(".outreach-campaign-mailboxes");
  await expect(mailboxes).toContainText("0 prontas de 0 selecionadas");
  await mailboxes.getByRole("checkbox", { name: /mia@nikufra.ai/ }).check();
  const requestPromise = page.waitForRequest((request) => request.method() === "PATCH" && request.url().endsWith("/campaigns/campaign-1"));
  await mailboxes.getByRole("button", { name: "Guardar seleção" }).click();
  const request = await requestPromise;
  expect(request.postDataJSON()).toEqual({ mailboxIds: [mailbox.id] });
  await expect(mailboxes).toContainText("0 prontas de 1 selecionadas");
});

test("new campaign form accepts a recipient list and multiple messages", async ({ page }) => {
  await openRoute(page, "/outreach/campanhas");
  await page.getByRole("button", { name: "Nova campanha" }).click();
  await page.getByRole("textbox", { name: "Nome", exact: true }).fill("Piloto Q4");
  await page.getByRole("combobox", { name: "Lista de destinatários" }).selectOption("audience-1");
  await page.getByRole("textbox", { name: "Assunto" }).fill("Primeiro contacto");
  await page.getByRole("textbox", { name: "Mensagem" }).fill("Olá {{nome}}");
  await page.getByRole("button", { name: "Adicionar mensagem" }).click();
  const second = page.locator(".outreach-create-step").nth(1);
  await second.getByRole("textbox", { name: "Assunto" }).fill("Seguimento");
  await second.getByRole("textbox", { name: "Mensagem" }).fill("Volto a contactar.");
  await expectNoCriticalAccessibilityViolations(page);
  const requestPromise = page.waitForRequest((request) => request.method() === "POST" && request.url().endsWith("/campaigns"));
  await page.getByRole("button", { name: "Criar rascunho" }).click();
  const payload = (await requestPromise).postDataJSON() as { audienceId: string; steps: Array<{ delayMinutes: number; variants: Array<{ subject: string }> }> };
  expect(payload.audienceId).toBe("audience-1");
  expect(payload.steps).toHaveLength(2);
  expect(payload.steps[1]).toMatchObject({ delayMinutes: 2_880, variants: [{ subject: "Seguimento" }] });
});

test("a draft campaign can attach a recipient list and save another message", async ({ page }) => {
  await openRoute(page, "/outreach/campanhas/campaign-1");
  const audience = page.locator(".outreach-campaign-audience");
  await audience.getByRole("combobox", { name: "Lista de destinatários" }).selectOption("audience-1");
  const attachRequest = page.waitForRequest((request) => request.method() === "PATCH" && request.url().endsWith("/campaigns/campaign-1") && Boolean((request.postDataJSON() as { addAudienceId?: string }).addAudienceId));
  await audience.getByRole("button", { name: "Adicionar lista" }).click();
  expect((await attachRequest).postDataJSON()).toEqual({ addAudienceId: "audience-1" });
  await expect(audience).toContainText("Fabricantes");

  const sequence = page.locator(".outreach-campaign-sequence");
  await sequence.getByRole("button", { name: "Editar mensagens" }).click();
  await sequence.getByRole("button", { name: "Adicionar email" }).click();
  await expectNoCriticalAccessibilityViolations(page);
  const second = sequence.locator(".outreach-sequence-step").nth(1);
  await second.getByRole("textbox", { name: "Assunto" }).fill("Seguimento");
  await second.getByRole("textbox", { name: "Mensagem" }).fill("Olá {{nome}}, volto a contactar.");
  const saveRequest = page.waitForRequest((request) => request.method() === "PATCH" && request.url().endsWith("/campaigns/campaign-1") && Boolean((request.postDataJSON() as { steps?: unknown[] }).steps));
  await sequence.getByRole("button", { name: "Guardar sequência" }).click();
  const payload = (await saveRequest).postDataJSON() as { steps: Array<{ delayMinutes: number; variants: Array<{ subject: string }> }> };
  expect(payload.steps).toHaveLength(2);
  expect(payload.steps[1]).toMatchObject({ delayMinutes: 2_880, variants: [{ subject: "Seguimento" }] });
  await expect(sequence).toContainText("Seguimento");
});

test("message test asks for an eligible lead and queues one real send", async ({ page }) => {
  await openRoute(page, "/outreach/campanhas/campaign-1", "light", true);
  await page.locator(".outreach-campaign-sequence").getByRole("button", { name: "Testar envio" }).click();
  await expectNoCriticalAccessibilityViolations(page);
  const dialog = page.locator(".outreach-dialog");
  const dialogWidth = await dialog.evaluate((element) => element.getBoundingClientRect().width);
  expect(dialogWidth).toBeGreaterThan(page.viewportSize()!.width < 640 ? 340 : 800);
  expect(Number.parseFloat(await dialog.locator("h2").evaluate((element) => getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(21);
  await page.getByRole("searchbox", { name: "Pesquisar contacto de teste" }).fill("Contacto de Teste");
  await page.locator(".outreach-dialog").getByRole("combobox", { name: "Destinatário", exact: true }).selectOption("44444444-4444-4444-8444-444444444444");
  await page.getByRole("checkbox", { name: /Confirmo que quero enviar/ }).check();
  const requestPromise = page.waitForRequest((request) => request.method() === "POST" && request.url().endsWith("/campaigns/campaign-1/message-tests"));
  await page.getByRole("button", { name: "Enviar teste" }).click();
  const request = await requestPromise;
  expect(request.headers()["idempotency-key"]).toBeTruthy();
  expect(request.postDataJSON()).toMatchObject({ stepId: "step-1", variantId: "variant-1", contactId: "44444444-4444-4444-8444-444444444444", mailboxId: mailbox.id });
  await expect(page.getByRole("status")).toContainText("Teste colocado em fila");
  await expect(page.locator(".outreach-message-tests")).toContainText("contacto@example.invalid");
});

test("message test refreshes stale DNS and shows the real CRM contact", async ({ page }) => {
  await openRoute(page, "/outreach/campanhas/campaign-1", "light", true, "valid", true);
  await page.locator(".outreach-campaign-sequence").getByRole("button", { name: "Testar envio" }).click();
  await expect(page.locator(".outreach-dialog").getByRole("combobox", { name: "Destinatário", exact: true })).toContainText("Contacto de Teste");
  await expect(page.locator(".outreach-dialog").getByRole("combobox", { name: "Remetente", exact: true })).toContainText("DNS por rever");
  await expect(page.getByRole("button", { name: "Enviar teste" })).toBeDisabled();
  const dnsRequest = page.waitForRequest((request) => request.method() === "POST" && request.url().endsWith(`/mailboxes/${mailbox.id}/dns`));
  await page.getByRole("button", { name: "Rever DNS" }).click();
  await dnsRequest;
  await expect(page.locator(".outreach-dialog").getByRole("combobox", { name: "Remetente", exact: true })).toHaveValue(mailbox.id);
});

test("message test explains when global sending is disabled", async ({ page }) => {
  await openRoute(page, "/outreach/campanhas/campaign-1");
  await page.locator(".outreach-campaign-sequence").getByRole("button", { name: "Testar envio" }).click();
  await expect(page.locator(".outreach-dialog").getByRole("alert")).toContainText("O envio global de Outreach está desligado");
  await expect(page.getByRole("button", { name: "Enviar teste" })).toBeDisabled();
});

test("an existing mailbox can restart OAuth with its own id and email", async ({ page }) => {
  await openRoute(page, "/outreach/mailboxes");
  await page.route("**/api/outreach/v1/mailboxes/oauth/start", (route) => route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: { code: "reauthorization_required", message: "Confirma novamente a conta Google." } }) }));
  const requestPromise = page.waitForRequest((request) => request.url().endsWith("/mailboxes/oauth/start"));
  await page.locator(".outreach-mailbox-card").getByRole("button", { name: "Reautorizar" }).click();
  const request = await requestPromise;
  expect(request.postDataJSON()).toEqual({ mailboxId: mailbox.id, provider: "google", emailHint: mailbox.email });
  await expect(page.locator(".outreach-mailbox-card").getByRole("alert")).toContainText("Confirma novamente");
});

test("a duplicate mailbox conflict explains how to reconnect", async ({ page }) => {
  await openRoute(page, "/outreach/mailboxes");
  await page.route("**/api/outreach/v1/mailboxes", (route) => {
    if (route.request().method() === "POST") return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: { code: "mailbox_conflict", message: "Conflito." } }) });
    return route.continue();
  });
  await page.getByRole("button", { name: "Ligar Google" }).first().click();
  await page.getByRole("textbox", { name: "Nome do remetente" }).fill("Nova conta");
  await page.getByRole("textbox", { name: "Email Google" }).fill("nova@nikufra.ai");
  await page.getByRole("button", { name: "Continuar com Google" }).click();
  await expect(page.getByRole("alert")).toContainText("Atualiza a lista e usa Ligar ou Reautorizar");
  await expect(page.getByRole("button", { name: "Atualizar lista" })).toBeVisible();
});
