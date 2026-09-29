import { beforeAll, describe, expect, it } from "vitest";
import { addDaysToDateString, localToUtc } from "@/lib/time";
import { withPublic } from "@/server/db/context";
import { searchProviders } from "@/server/modules/providers";
import { categories, inDays, makeProvider, ownerDb } from "./helpers";

type Provider = Awaited<ReturnType<typeof makeProvider>>;

/** Blocks a technician for the whole local day (Africa/Casablanca). */
async function dayOff(p: Provider, technicianId: string, date: string) {
  await ownerDb().timeOff.create({
    data: {
      providerOrgId: p.org.id,
      technicianId,
      startsAt: localToUtc(date, "00:00"),
      endsAt: localToUtc(addDaysToDateString(date, 1), "00:00"),
      createdById: p.manager.userId,
    },
  });
}

describe("provider directory: declared availability filter", () => {
  let provider: Provider;
  let draft: Provider;
  let categoryId: string;
  const date = inDays(4);
  const find = (search: { q: string; date?: string; categoryId?: string }) => withPublic((tx) => searchProviders(tx, search));

  beforeAll(async () => {
    provider = await makeProvider("Dispo");
    draft = await makeProvider("Dispo non approuvé", { approved: false });
    categoryId = (await categories())[0]!.id;
  });

  it("matches a provider that declares an active technician that day, and respects skills and time off", async () => {
    const q = provider.org.name;
    expect((await find({ q, date })).total).toBe(1);

    // With an equipment category, only technicians with that skill count.
    expect((await find({ q, date, categoryId })).total).toBe(0);
    await ownerDb().technicianSkill.create({ data: { technicianId: provider.technicians[0]!.id, equipmentCategoryId: categoryId, providerOrgId: provider.org.id } });
    expect((await find({ q, date, categoryId })).total).toBe(1);

    // A partial time off leaves part of the declared window: still available.
    await ownerDb().timeOff.create({
      data: {
        providerOrgId: provider.org.id,
        technicianId: provider.technicians[0]!.id,
        startsAt: localToUtc(date, "08:00"),
        endsAt: localToUtc(date, "12:00"),
        createdById: provider.manager.userId,
      },
    });
    expect((await find({ q, date, categoryId })).total).toBe(1);

    // A full day off for the skilled technician removes the category match; the other still counts.
    await dayOff(provider, provider.technicians[0]!.id, date);
    expect((await find({ q, date, categoryId })).total).toBe(0);
    expect((await find({ q, date })).total).toBe(1);

    // Everyone off → not available that day, but available the next day.
    await dayOff(provider, provider.technicians[1]!.id, date);
    expect((await find({ q, date })).total).toBe(0);
    expect((await find({ q, date: addDaysToDateString(date, 1) })).total).toBe(1);

    // Deactivated technicians do not count.
    await ownerDb().technicianProfile.updateMany({ where: { providerOrgId: provider.org.id }, data: { active: false } });
    expect((await find({ q, date: addDaysToDateString(date, 1) })).total).toBe(0);
  });

  it("never exposes unapproved providers or the underlying private schedule", async () => {
    expect((await find({ q: draft.org.name, date })).total).toBe(0);
    const leaked = await withPublic(async (tx) => ({
      windows: await tx.availabilityWindow.count({ where: { providerOrgId: provider.org.id } }),
      timeOff: await tx.timeOff.count({ where: { providerOrgId: provider.org.id } }),
      technicians: await tx.technicianProfile.count({ where: { providerOrgId: provider.org.id } }),
      reservations: await tx.appointmentReservation.count(),
    }));
    expect(leaked).toEqual({ windows: 0, timeOff: 0, technicians: 0, reservations: 0 });
  });
});
