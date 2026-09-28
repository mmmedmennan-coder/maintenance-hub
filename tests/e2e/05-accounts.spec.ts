import { type Browser, type Page, expect, test } from "@playwright/test";
import { BASE_URL, demo, linkFromMail, signIn } from "./helpers";

test.setTimeout(180_000);

async function as(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({ baseURL: BASE_URL, locale: "fr-FR", timezoneId: "Africa/Casablanca" });
  const page = await context.newPage();
  await signIn(page, email);
  return page;
}

test("provider owner invites a technician who registers, verifies and joins with the technician role", async ({ browser, page }) => {
  const stamp = Date.now().toString(36);
  const email = `tech.${stamp}@example.test`;
  const password = "Tech-password-2026";

  const owner = await as(browser, demo("prestataire2"));
  await owner.goto("/prestataire/equipe");
  await owner.getByLabel(/^Adresse e-mail/).fill(email);
  await owner.locator('select[name="role"]').selectOption("technician");
  await owner.getByRole("button", { name: "Envoyer l'invitation" }).click();
  await expect(owner.getByText(`Invitation envoyée à ${email}.`)).toBeVisible();

  const invitationLink = await linkFromMail(email, /http:\/\/localhost:3100\/invitations\/[A-Za-z0-9-]+/);
  const invitationPath = new URL(invitationLink).pathname;
  await page.goto(invitationPath);
  await expect(page).toHaveURL(/\/connexion\?next=/);
  await page.getByRole("link", { name: /Créer un compte|Pas encore de compte/ }).click();
  await expect(page).toHaveURL(/\/inscription\?next=/);
  await page.getByLabel(/^Nom et prénom/).fill("Technicien E2E");
  await page.getByLabel(/^Adresse e-mail/).fill(email);
  await page.getByLabel(/^Mot de passe/).fill(password);
  await page.getByLabel(/^Confirmer le mot de passe/).fill(password);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  const verify = await linkFromMail(email, /http:\/\/localhost:3100\/api\/auth\/verify-email\S+/);
  await page.goto(verify);
  await expect(page).toHaveURL(new RegExp(invitationPath));
  await page.getByRole("button", { name: "Rejoindre l'organisation" }).click();
  await expect(page).toHaveURL(/\/technicien$/);

  // The owner now sees the new member; the plan's 3-seat limit is reached.
  await owner.reload();
  await expect(owner.getByText("Technicien E2E")).toBeVisible();
  await expect(owner.getByText(/Limite de 3 membres atteinte/)).toBeVisible();
});

test("password reset by e-mail link, then sign-in with the new password", async ({ page }) => {
  const email = demo("restaurant");
  await page.goto("/mot-de-passe-oublie");
  await page.getByLabel(/^Adresse e-mail/).fill(email);
  await page.getByRole("button", { name: /Envoyer le lien/ }).click();
  await expect(page.getByText(/un lien valable une heure/)).toBeVisible();

  const link = await linkFromMail(email, /http:\/\/localhost:3100\/api\/auth\/reset-password\S+/);
  await page.goto(link);
  await expect(page).toHaveURL(/\/reinitialiser-mot-de-passe/);
  await page.getByLabel(/^Nouveau mot de passe/).fill("Nouveau-mdp-2026");
  await page.getByLabel(/^Confirmer le mot de passe/).fill("Nouveau-mdp-2026");
  await page.getByRole("button", { name: /Enregistrer/ }).click();
  await expect(page.getByText("Vous pouvez vous connecter avec votre nouveau mot de passe.")).toBeVisible();

  await page.goto("/connexion");
  await page.getByLabel(/^Adresse e-mail/).fill(email);
  await page.getByLabel(/^Mot de passe/).fill("Nouveau-mdp-2026");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/client$/);
});
