import { Form, redirect, useActionData, useNavigation, useLoaderData, useSearchParams } from "react-router";
import type { MetaFunction } from "react-router";
import type { Route } from "./+types/auth.login";
import { AuthForm, Field, SubmitButton } from "~/components/AuthForm";
import { getSessionUser, verifyCredentials, createSession } from "~/lib/auth.server";
import { getUserWorkspaces } from "~/lib/workspace.server";
import { isLocalLoginEnabled, isRegistrationOpen } from "~/lib/db.server";
import { getActiveAuthProviders } from "~/extensions/index.server";
import { checkRateLimit, getClientIp } from "~/lib/rate-limit.server";

export const meta: MetaFunction = () => [{ title: "Sign in — loica" }];

export async function loader({ request }: Route.LoaderArgs) {
  const user = getSessionUser(request);
  if (user) {
    const workspaces = getUserWorkspaces(user.id);
    throw redirect(workspaces.length > 0 ? "/w" : "/");
  }
  const authProviders = getActiveAuthProviders();
  if (!isLocalLoginEnabled() && authProviders.length === 0) {
    throw redirect("/");
  }
  return {
    authProviders,
    localLoginEnabled: isLocalLoginEnabled(),
    registrationOpen: isRegistrationOpen(),
  };
}

export async function action({ request }: Route.ActionArgs) {
  if (!isLocalLoginEnabled()) {
    return { error: "Local login is disabled." };
  }

  const ip = getClientIp(request);
  const { allowed, retryAfterSeconds } = checkRateLimit(ip, {
    windowMs: 15 * 60 * 1000,
    max: 10,
  });
  if (!allowed) {
    return { error: `Too many login attempts. Please try again in ${retryAfterSeconds} seconds.` };
  }

  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  const user = await verifyCredentials(email, password);
  if (!user) {
    return { error: "Incorrect email or password." };
  }

  const cookie = createSession(user.id);

  const workspaces = getUserWorkspaces(user.id);
  const destination = workspaces.length > 0 ? "/w" : "/";

  throw redirect(destination, { headers: { "Set-Cookie": cookie } });
}

export default function Login() {
  const { authProviders, localLoginEnabled, registrationOpen } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state === "submitting";
  const [searchParams] = useSearchParams();
  const errorParam = searchParams.get("error");
  // Generic extension login failure (e.g. ?error=google_failed) — strip
  // the suffix to derive the provider id, then look up its label for the
  // toast.
  const failedProvider = errorParam?.endsWith("_failed")
    ? authProviders.find((p) => p.id === errorParam.replace(/_failed$/, ""))
    : null;
  const error = failedProvider
    ? `${failedProvider.label} failed. Please try again.`
    : result?.error;

  return (
    <AuthForm title={localLoginEnabled ? "Sign in" : undefined} error={error}>
      {authProviders.length > 0 && (
        <div style={{ marginBottom: localLoginEnabled ? "1.5rem" : 0, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {authProviders.map((p) => (
            <a
              key={p.id}
              href={p.loginPath}
              style={{
                display: "block",
                width: "100%",
                padding: "0.5rem 1rem",
                fontSize: "var(--fs-sm)",
                fontWeight: 700,
                background: "var(--fg)",
                color: "var(--bg)",
                border: "none",
                borderRadius: "4px",
                textAlign: "center",
                textDecoration: "none",
                cursor: "pointer",
                boxSizing: "border-box",
              }}
            >
              {p.label}
            </a>
          ))}
        </div>
      )}

      {authProviders.length > 0 && localLoginEnabled && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            marginBottom: "1rem",
            fontSize: "var(--fs-xs)",
            opacity: 0.4,
          }}
        >
          <div style={{ flex: 1, height: "1px", background: "var(--fg)" }} />
          <span>or</span>
          <div style={{ flex: 1, height: "1px", background: "var(--fg)" }} />
        </div>
      )}

      {localLoginEnabled && (
        <Form method="post" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <Field label="Email" name="email" type="email" autoComplete="email" />
          <Field label="Password" name="password" type="password" autoComplete="current-password" />

          <SubmitButton disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </SubmitButton>

          {registrationOpen && (
            <p style={{ margin: 0, fontSize: "var(--fs-xs)", opacity: 0.5, textAlign: "center" }}>
              No account?{" "}
              <a href="/signup" style={{ color: "var(--fg)" }}>
                Sign up
              </a>
            </p>
          )}
        </Form>
      )}
    </AuthForm>
  );
}
