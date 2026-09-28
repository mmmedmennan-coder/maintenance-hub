import { type Browser, type Page, expect, test } from "@playwright/test";
import { BASE_URL, confirmDialog, demo, expectNoHorizontalOverflow, linkFromMail, signIn, workday } from "./helpers";

test.setTimeout(240_000);

async function as(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({ baseURL: BASE_URL, locale: "fr-FR", timezoneId: "Africa/Casablanca" });
  const page = await context.newPage();
  await signIn(page, email);
  return page;
}

test("new customer: sign-up, e-mail verification, onboarding, assets, request, offer, selection, confirmation", async ({ page, browser }) => {
  const stamp = Date.now().toString(36);
  const email = `e2e.${stamp}@example.test`;
  const password = "E2e-password-2026";
  const title = `Vitrine à 10 °C (${stamp})`;
  const date = workday(6);

  // 1. Sign-up → verification e-mail (captured by Mailpit) → onboarding.
  await page.goto("/inscription");
  await page.getByLabel(/^Nom et prénom/).fill("Client E2E");
  await page.getByLabel(/^Adresse e-mail/).fill(email);
  await page.getByLabel(/^Mot de passe/).fill(password);
  await page.getByLabel(/^Confirmer le mot de passe/).fill(password);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(page.getByText("Vérifiez votre boîte de réception")).toBeVisible();
  const link = await linkFromMail(email, /http:\/\/localhost:3100\/api\/auth\/verify-email\S+/);
  await page.goto(link);
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByRole("radio", { name: /Je gère des équipements/ }).check();
  await page.getByLabel(/^Nom de l'organisation/).fill(`Épicerie E2E ${stamp}`);
  await page.getByLabel(/^Ville/).fill("Rabat");
  await page.getByRole("button", { name: "Créer l'organisation" }).click();
  await expect(page).toHaveURL(/\/client$/);

  // 2. Sign-in form with a return path.
  await page.context().clearCookies();
  await page.goto("/connexion?next=%2Fclient%2Fsites%2Fnouveau");
  await page.getByLabel(/^Adresse e-mail/).fill(email);
  await page.getByLabel(/^Mot de passe/).fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/client\/sites\/nouveau$/);

  // 3. Site and equipment.
  await page.getByLabel(/^Nom du site/).fill("Boutique E2E");
  await page.getByRole("textbox", { name: "Adresse", exact: true }).fill("10 avenue Mohammed V");
  await page.getByLabel(/^Consignes d'accès/).fill("Accès par l'entrée de service.");
  await page.getByRole("button", { name: "Enregistrer le site" }).click();
  await expect(page).toHaveURL(/\/client\/sites\/[0-9a-f-]{36}$/);
  await page.goto("/client/equipements/nouveau");
  await page.getByLabel(/^Catégorie d'équipement/).selectOption({ label: "Vitrine réfrigérée" });
  await page.getByLabel(/^Nom de l'équipement/).fill("Vitrine E2E");
  await page.getByRole("button", { name: "Enregistrer l'équipement" }).click();
  await expect(page).toHaveURL(/\/client\/equipements\/[0-9a-f-]{36}$/);

  // 4. Request wizard → draft → submit → invite one provider.
  await page.goto("/client/demandes/nouvelle");
  await page.getByRole("button", { name: "Suivant" }).click();
  await page.getByLabel(/^Titre/).fill(title);
  await page.getByLabel(/^Symptômes observés/).fill("La vitrine ne descend plus sous 10 °C depuis hier soir.");
  await page.getByRole("button", { name: "Suivant" }).click();
  await page.getByLabel("Date", { exact: true }).first().fill(date);
  await page.getByLabel("De", { exact: true }).first().fill("14:00");
  await page.getByLabel("À", { exact: true }).first().fill("17:00");
  await page.getByRole("button", { name: "Suivant" }).click();
  await page.getByRole("button", { name: "Créer le brouillon" }).click();
  await expect(page).toHaveURL(/\/client\/demandes\/[0-9a-f-]{36}\?etape=photos/);
  const requestUrl = page.url().split("?")[0]!;
  await page.getByRole("button", { name: "Envoyer la demande" }).click();
  await expect(page.getByRole("heading", { name: "Inviter des prestataires" })).toBeVisible();
  await page.getByRole("checkbox", { name: /Froid Atlas Services/ }).check();
  await page.getByRole("button", { name: "Inviter (1)" }).click();
  await expect(page.locator("section", { hasText: "Prestataires invités" }).getByText("Froid Atlas Services (démo)")).toBeVisible();

  // 5. Provider answers with a diagnostic offer (brief only: no address before confirmation).
  const provider = await as(browser, demo("prestataire"));
  await provider.goto("/prestataire/invitations");
  await provider.getByRole("row", { name: new RegExp(title.replace(/[()°]/g, ".")) }).getByRole("link").click();
  await expect(provider.getByText("10 avenue Mohammed V")).toHaveCount(0);
  await provider.getByLabel(/^Périmètre de l'intervention/).fill("Diagnostic de la vitrine : ventilation, sondes, circuit.");
  await provider.getByLabel(/^Frais de déplacement/).fill("100");
  await provider.getByLabel(/^Frais de diagnostic/).fill("250");
  await expect(provider.getByText("420,00").first()).toBeVisible(); // (100 + 250) × 1,20 computed live
  await provider.getByRole("button", { name: "Émettre l'offre" }).click();
  await expect(provider.getByText("Offre émise : elle est désormais visible par le client.")).toBeVisible();

  // 6. Customer compares and selects on a phone (card presentation) → booking pending confirmation.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(requestUrl);
  await expectNoHorizontalOverflow(page);
  await expect(page.locator("#offres").getByRole("link", { name: "Froid Atlas Services (démo)" })).toBeVisible();
  await expect(page.locator("#offres")).toContainText("420,00 MAD");
  await page.getByRole("button", { name: "Choisir" }).first().click();
  await confirmDialog(page, "Retenir cette offre");
  await expect(page).toHaveURL(/\/client\/rendez-vous\/[0-9a-f-]{36}$/);
  await expect(page.getByText("En attente de confirmation").first()).toBeVisible();
  const bookingId = page.url().split("/").pop()!;

  // 7. Dispatcher confirms with a technician; the database checks availability and overlaps.
  const dispatcher = await as(browser, demo("planificateur"));
  await dispatcher.goto(`/prestataire/rendez-vous/${bookingId}`);
  await expect(dispatcher.getByRole("heading", { name: "Confirmation requise" })).toBeVisible();
  await dispatcher.getByRole("button", { name: "Confirmer le rendez-vous" }).click();
  await expect(dispatcher.getByText("Créneau confirmé")).toBeVisible();
  await expect(dispatcher.getByText("10 avenue Mohammed V", { exact: false })).toBeVisible();

  // 8. The customer sees the confirmed slot and the assigned technician.
  await page.reload();
  await expect(page.getByText("Créneau confirmé")).toBeVisible();
  await expect(page.getByText("Ahmed Ouazzani").first()).toBeVisible();
});
