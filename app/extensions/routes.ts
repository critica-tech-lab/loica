// Build-time route aggregator. Each extension contributes its own
// `RouteConfigEntry[]` from a sibling `routes.ts` (when it has any), and
// `app/routes.ts` spreads `extensionRoutes` into the top-level config.
//
// Keeping this file separate from `index.ts` / `index.server.ts` so the
// `@react-router/dev/routes` build-time import never leaks into the client
// or server bundles — only `app/routes.ts` reads it.

import type { RouteConfigEntry } from "@react-router/dev/routes";

export const extensionRoutes: RouteConfigEntry[] = [];
