import { expect, test } from "@playwright/test";
import { demo, expectNoHorizontalOverflow, signIn } from "./helpers";

test("public pages present the pilot honestly and work on a phone", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.goto("/prestataires");
  await expect(page.getByText("Froid Atlas Services (démo)").first()).toBeVisible();
  // Providers awaiting verification are never listed.
  await expect(page.getByText("Clim & Froid Témara (démo)")).toHaveCount(0);
  await page.getByText("Froid Atlas Services (démo)").first().click();
  await expect(page.getByText(/aucun contrôle réel/i).first()).toBeVisible();
  await page.goto("/tarifs");
  await expect(page.getByText(/399/).first()).toBeVisible();

  await page.setViewportSize({ width: 360, height: 780 });
  for (const path of ["/", "/prestataires", "/comment-ca-marche", "/tarifs", "/connexion", "/inscription"]) {
    await page.goto(path);
    await expectNoHorizontalOverflow(page);
  }
});

test("private pages require sign-in and each role stays in its workspace", async ({ page }) => {
  await page.goto("/client/demandes");
  await expect(page).toHaveURL(/\/connexion\?next=%2Fclient%2Fdemandes/);

  await signIn(page, demo("technicien"));
  await page.goto("/client");
  await expect(page).toHaveURL(/\/technicien$/);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/technicien$/);
  await page.goto("/prestataire/paiements");
  await expect(page).toHaveURL(/\/technicien$/);
});

test("a customer cannot read another organisation's booking through the API", async ({ page }) => {
  await signIn(page, demo("restaurant"));
  const own = await page.request.get("/api/v1/bookings");
  expect(own.ok()).toBeTruthy();
  const restaurantIds = ((await own.json()).data.items as { id: string }[]).map((b) => b.id);

  await page.context().clearCookies();
  await signIn(page, demo("client"));
  for (const id of restaurantIds) {
    const res = await page.request.get(`/api/v1/bookings/${id}`);
    expect(res.status()).toBe(404);
  }
});
