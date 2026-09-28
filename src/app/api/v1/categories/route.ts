import { withPublic } from "@/server/db/context";
import { publicRoute } from "@/server/http";
import { listEquipmentCategories } from "@/server/modules/reference";

export const GET = publicRoute({}, async () => withPublic((tx) => listEquipmentCategories(tx)));
