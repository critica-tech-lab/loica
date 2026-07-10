import { route, type RouteConfigEntry } from "@react-router/dev/routes";

export const presentationsRoutes: RouteConfigEntry[] = [
  route("w/doc/:id/present", "extensions/presentations/present.tsx"),
];

// Discovered by the glob in `app/extensions/routes.ts`.
export default presentationsRoutes;
