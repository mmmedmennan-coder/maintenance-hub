import { withPublic } from "@/server/db/context";
import { publicRoute } from "@/server/http";
import { listServiceAreas } from "@/server/modules/reference";

export const GET = publicRoute({}, async () => withPublic((tx) => listServiceAreas(tx)));
