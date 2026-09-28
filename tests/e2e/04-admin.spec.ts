import { type Browser, type Page, expect, test } from "@playwright/test";
import { BASE_URL, confirmDialog, demo, signIn } from "./helpers";

test.setTimeout(180_000);

async function as(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({ baseURL: BASE_URL, locale: "fr-FR", timezoneId: "Africa/Casablanca" });
  const page = await context.newPage();
  await signIn(page, email);
  return page;
}

test("admin verifies a provider: approval requires a verified identity check", async ({ browser }) => {
  const admin = await as(browser, demo("admin"));
  await admin.goto("/admin/prestataires?statut=SUBMITTED");
  await admin.getByRole("link", { name: "Clim & Froid Témara (démo)" }).click();

  await admin.getByRole("button", { name: "Approuver" }).click();
  await admin.getByRole("dialog").getByLabel(/^Motif/).fill("Dossier complet.");
  await confirmDialog(admin, "Approuver");
  await expect(admin.getByRole("dialog")).toContainText("Vérifiez au minimum l'identité de l'entreprise");
  await admin.getByRole("dialog").getByRole("button", { name: "Annuler" }).click();

  await admin.locator("summary", { hasText: "Enregistrer un contrôle" }).click();
  await admin.getByLabel(/^Note publique/).fill("Registre de commerce consulté (test de bout en bout).");
  await admin.getByRole("button", { name: "Enregistrer un contrôle" }).click();
  await expect(admin.getByText("Les modifications ont été enregistrées.")).toBeVisible();

  await admin.getByRole("button", { name: "Approuver" }).click();
  await admin.getByRole("dialog").getByLabel(/^Motif/).fill("Identité vérifiée.");
  await confirmDialog(admin, "Approuver");
  await expect(admin.getByText("Approuvé").first()).toBeVisible();

  // The decision is in the audit log.
  await admin.goto("/admin/audit?type=provider_profile");
  await expect(admin.getByText("provider.approve").first()).toBeVisible();
});

test("human-assisted routing of a breakdown and dispute mediation", async ({ browser }) => {
  const admin = await as(browser, demo("admin"));
  await admin.goto("/admin/routage");
  await admin.getByRole("row", { name: /Armoire pâtisserie/ }).getByRole("link").click();
  await admin.getByRole("checkbox", { name: /Froid Atlas Services/ }).check();
  await admin.getByRole("button", { name: "Solliciter ce prestataire" }).click();
  await expect(admin.getByText("Invité — sans réponse")).toBeVisible();

  const provider = await as(browser, demo("prestataire"));
  await provider.goto("/prestataire/invitations?statut=INVITED");
  await expect(provider.getByRole("row", { name: /Armoire pâtisserie/ })).toBeVisible();

  await admin.goto("/admin/litiges");
  await admin.getByRole("row", { name: /Ouvert/ }).getByRole("link").first().click();
  await admin.getByRole("button", { name: "Clore le litige" }).click();
  await admin.getByRole("dialog").getByLabel(/^Résumé de la résolution/).fill("Le prestataire complète le rapport avec la mesure de dureté ; montant du diagnostic maintenu.");
  await confirmDialog(admin, "Clore le litige");
  await expect(admin.getByText("Résolu").first()).toBeVisible();
});
