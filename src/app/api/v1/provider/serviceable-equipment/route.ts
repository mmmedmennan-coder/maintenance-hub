import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { serviceableEquipment } from "@/server/modules/maintenance";

export const GET = actorRoute({ orgTypes: ["PROVIDER"], roles: ["provider_owner", "provider_dispatcher"] }, async ({ actor }) => withActor(actor, (tx) => serviceableEquipment(tx, actor)));
