// Build-time route aggregator. Auto-discovers each extension's `routes.ts`
// (default export, or a named `routes` export) and `app/routes.ts` spreads
// `extensionRoutes` into the top-level config. Core names no extension —
// mirrors the registry globs in `index.ts` / `index.server.ts`.
//
// Kept separate from `index.ts` / `index.server.ts` so the
// `@react-router/dev/routes` build-time import never leaks into the client
// or server bundles — only `app/routes.ts` reads it.

import type { RouteConfigEntry } from "@react-router/dev/routes";

const routeModules = import.meta.glob<{
  default?: RouteConfigEntry[];
  routes?: RouteConfigEntry[];
}>("./*/routes.ts", { eager: true });

export const extensionRoutes: RouteConfigEntry[] = Object.values(routeModules).flatMap(
  (m) => m.default ?? m.routes ?? [],
);
