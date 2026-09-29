import { type Browser, type Page, expect, test } from "@playwright/test";
import { JPEG_8x8, PNG_8x8 } from "../fixtures";
import { BASE_URL, confirmDialog, demo, expectNoHorizontalOverflow, signIn } from "./helpers";

test.setTimeout(240_000);

async function as(browser: Browser, email: string, viewport = { width: 1440, height: 900 }): Promise<Page> {
  const context = await browser.newContext({ baseURL: BASE_URL, locale: "fr-FR", timezoneId: "Africa/Casablanca", viewport });
  const page = await context.newPage();
  await signIn(page, email);
  return page;
}

test("repair approval by exact version, technician work and report on a phone, acknowledgment and PDF", async ({ browser }) => {
  // Seeded job: diagnosis done yesterday, repair quote waiting for the customer.
  const viewer = await as(browser, demo("lecteur"));
  await viewer.goto("/client/rendez-vous");
  const row = viewer.getByRole("row", { name: /Chambre froide négative — dépôt/ });
  const href = await row.getByRole("link").first().getAttribute("href");
  const bookingId = href!.split("/").pop()!;

  // A read-only member sees the quote but cannot approve it.
  await viewer.goto(`/client/rendez-vous/${bookingId}`);
  await expect(viewer.getByText("Version 1").first()).toBeVisible();
  await expect(viewer.getByRole("button", { name: "Approuver" })).toHaveCount(0);
  await expect(viewer.getByText(/ne permet pas d'approuver/).first()).toBeVisible();

  // The manager approves the exact version displayed (hash + idempotency key sent), on a phone.
  const manager = await as(browser, demo("responsable"), { width: 390, height: 844 });
  await manager.goto(`/client/rendez-vous/${bookingId}`);
  await expectNoHorizontalOverflow(manager);
  await manager.getByRole("button", { name: "Approuver" }).click();
  await expect(manager.getByRole("dialog")).toContainText(/2[\s.\u202f]976,00/);
  await confirmDialog(manager, /^Approuver pour/);
  await expect(manager.getByText(/Approuvé le .* pour 2[\s.\u202f]976,00/).first()).toBeVisible();

  // Technician on a phone: start the approved work, upload photos (one invalid), submit the report.
  const tech = await as(browser, demo("technicien"), { width: 390, height: 844 });
  await tech.goto(`/technicien/interventions/${bookingId}`);
  await expectNoHorizontalOverflow(tech);
  await tech.getByRole("button", { name: "Commencer les travaux" }).click();
  await confirmDialog(tech, "Confirmer");
  await expect(tech.getByText("Travaux approuvés en cours.")).toBeVisible();

  const reportUpload = tech.locator("#rapport input[type=file]");
  // A file whose content is not an image is refused by the server and stays visibly "not saved".
  await reportUpload.setInputFiles({ name: "faux.jpg", mimeType: "image/jpeg", buffer: Buffer.from("ceci n'est pas une image") });
  await expect(tech.getByText("Non enregistré").first()).toBeVisible();
  await expect(tech.getByRole("button", { name: "Réessayer" })).toBeVisible();
  await reportUpload.setInputFiles({ name: "evaporateur.jpg", mimeType: "image/jpeg", buffer: JPEG_8x8 });
  await expect(tech.getByText("Enregistré", { exact: true }).first()).toBeVisible();
  await expect(tech.getByRole("checkbox", { name: /evaporateur\.jpg/ })).toBeChecked();
  await reportUpload.setInputFiles({ name: "compresseur.png", mimeType: "image/png", buffer: PNG_8x8 });
  await expect(tech.getByRole("checkbox", { name: /compresseur\.png/ })).toBeChecked();

  await tech.getByLabel(/^Constat/).fill("Fuite localisée sur un raccord de la ligne liquide, contacteur usé.");
  await tech.getByLabel(/^Travaux réalisés/).fill("Raccord refait, contacteur remplacé, tirage au vide et recharge. −20 °C atteints.");
  await tech.getByRole("button", { name: "Soumettre le rapport" }).click();
  await expect(tech.getByText(/Soumis par Ahmed Ouazzani/)).toBeVisible();
  await expectNoHorizontalOverflow(tech);

  // Customer acknowledges; the worker generates the report PDF.
  const owner = await as(browser, demo("client"));
  await owner.goto(`/client/rendez-vous/${bookingId}`);
  await owner.getByRole("button", { name: "Prendre en compte le rapport" }).click();
  await confirmDialog(owner, "Prendre en compte le rapport");
  await expect(owner.getByText(/Rapport pris en compte le/)).toBeVisible();
  const reportLink = owner.getByRole("link", { name: "Télécharger le rapport (PDF)" });
  await expect(async () => {
    await owner.reload();
    await expect(reportLink).toBeVisible();
  }).toPass({ timeout: 30_000 });
  const pdf = await owner.request.get((await reportLink.getAttribute("href"))!);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  const pdfBody = await pdf.body();
  expect(pdfBody.subarray(0, 5).toString()).toBe("%PDF-");
  // Both photos (JPEG and PNG) are embedded as images, not just listed by name.
  expect(pdfBody.toString("latin1").match(/\/Subtype \/Image/g)).toHaveLength(2);

  // Someone from another organisation cannot download it.
  const outsider = await as(browser, demo("restaurant"));
  const denied = await outsider.request.get((await reportLink.getAttribute("href"))!);
  expect(denied.status()).toBe(404);
});

test("payments: customer reports, provider confirms receipt; balances only move on confirmation", async ({ browser }) => {
  const customer = await as(browser, demo("restaurant"));
  await customer.goto("/client/rendez-vous");
  const href = await customer.getByRole("row", { name: /Chambre froide négative cuisine/ }).getByRole("link").first().getAttribute("href");
  await customer.goto(href!);
  await customer.getByRole("button", { name: "Déclarer un paiement" }).click();
  await customer.getByRole("dialog").getByLabel(/^Montant/).fill("420");
  await customer.getByRole("dialog").getByLabel(/^Référence externe/).fill("VIR-E2E-1");
  await confirmDialog(customer, "Enregistrer");
  await expect(customer.getByText("Déclaré par le client").first()).toBeVisible();
  // The typed amount is recorded once, in centimes: 420 MAD (not 42 000).
  await expect(customer.locator("#paiements")).toContainText("420,00 MAD");

  const provider = await as(browser, demo("prestataire2"));
  await provider.goto("/prestataire/paiements");
  const paymentRow = provider.getByRole("row", { name: /VIR-E2E-1/ });
  await paymentRow.getByRole("button", { name: "Confirmer la réception" }).click();
  await confirmDialog(provider, "Confirmer la réception");
  await expect(provider.getByRole("row", { name: /VIR-E2E-1/ })).toContainText("Réception confirmée");
  await expect(provider.getByRole("row", { name: /VIR-E2E-1/ })).toContainText("420,00");
});

test("technician issues a change-order quote with live totals; the customer sees the exact amount", async ({ browser }) => {
  const customer = await as(browser, demo("restaurant"));
  await customer.goto("/client/rendez-vous");
  const href = await customer.getByRole("row", { name: /Chambre froide négative cuisine/ }).getByRole("link").first().getAttribute("href");
  const bookingId = href!.split("/").pop()!;

  const tech = await as(browser, demo("technicien2"), { width: 390, height: 844 });
  await tech.goto(`/technicien/interventions/${bookingId}`);
  await tech.locator("summary", { hasText: "Proposer des travaux supplémentaires" }).click();
  const editor = tech.locator("details[open]").filter({ hasText: "Lignes du devis" });
  await editor.getByLabel(/^Travaux proposés/).fill("Remplacement des deux joints de porte, usés et déchirés.");
  await editor.getByLabel(/^Désignation/).fill("Joint de porte magnétique");
  await editor.getByLabel(/^Quantité/).fill("2");
  await editor.getByLabel(/^Prix unitaire/).fill("150");
  await editor.getByLabel(/^TVA/).fill("20");
  await expect(editor.getByText("360,00 MAD").first()).toBeVisible();
  await editor.getByRole("button", { name: "Émettre au client" }).click();
  await expect(tech.getByText("Un devis de réparation attend la décision du client.")).toBeVisible();
  await expectNoHorizontalOverflow(tech);

  await customer.goto(`/client/rendez-vous/${bookingId}`);
  const quote = customer.locator("#devis section", { hasText: "Travaux supplémentaires n°1" });
  await expect(quote).toContainText("360,00 MAD");
  await expect(quote.getByRole("button", { name: "Approuver" })).toBeVisible();
});
