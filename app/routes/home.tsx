import { redirect } from "react-router";
import type { MetaFunction } from "react-router";
import type { Route } from "./+types/home";
import { getSessionUser } from "~/lib/auth.server";
import { getUserWorkspaces } from "~/lib/workspace.server";
import { getSharedFoldersForUser } from "~/lib/sharing.server";
import { isRegistrationOpen, isLocalLoginEnabled } from "~/lib/db.server";
import { getActiveAuthProviders } from "~/extensions/index.server";
import { AppShell } from "~/components/AppShell";
import { LogoIcon } from "~/components/icons";

export async function loader({ request }: Route.LoaderArgs) {
  const user = getSessionUser(request);
  if (user) {
    const workspaces = getUserWorkspaces(user.id);
    if (workspaces.length > 0) throw redirect("/w");
    const shared = getSharedFoldersForUser(user.id);
    if (shared.length > 0) throw redirect("/shared");
  }
  return {
    registrationOpen: isRegistrationOpen(),
    loginEnabled: isLocalLoginEnabled(),
    authProviders: getActiveAuthProviders(),
  };
}

export const meta: MetaFunction = () => [
  { title: "loica" },
  { name: "description", content: "Collaborative markdown editing." },
];

export default function Home({ loaderData }: Route.ComponentProps) {
  const { registrationOpen, loginEnabled, authProviders } = loaderData;

  return (
    <AppShell scrollable>
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "3rem 1.5rem",
          gap: "2rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.75rem" }}>
          <LogoIcon style={{ width: "auto", height: "clamp(2rem, 6vw, 3rem)" }} />
          <h1
            style={{
              fontSize: "clamp(2rem, 6vw, 3rem)",
              fontWeight: 700,
              margin: 0,
              letterSpacing: "-0.04em",
            }}
          >
            loica
          </h1>
        </div>
        <p style={{ margin: 0, opacity: 0.5, fontSize: "0.9rem", textAlign: "center", maxWidth: "28rem" }}>
          Collaborative markdown editing.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "0.5rem", alignItems: "center" }}>
          {authProviders.map((p) => (
            <a key={p.id} href={p.loginPath} className="home-link-primary">
              {p.label}
            </a>
          ))}
          {loginEnabled && (
            <a href="/login" className="home-link-btn">
              sign in
            </a>
          )}
          {registrationOpen && (
            <a href="/signup" className="home-link-btn">
              sign up
            </a>
          )}
        </div>
      </div>
    </AppShell>
  );
}
