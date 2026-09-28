import { Form, redirect, useActionData, useNavigation, useLoaderData } from "react-router";
import type { MetaFunction } from "react-router";
import type { Route } from "./+types/reset-password.$token";
import { AuthForm, Field, SubmitButton } from "~/components/AuthForm";
import { getPasswordResetTokenUser, consumePasswordResetToken, validatePassword, createSession } from "~/lib/auth.server";

export const meta: MetaFunction = () => [{ title: "Set your password — loica" }];

export async function loader({ params }: Route.LoaderArgs) {
  const info = getPasswordResetTokenUser(params.token);
  return { valid: !!info };
}

export async function action({ request, params }: Route.ActionArgs) {
  const info = getPasswordResetTokenUser(params.token);
  if (!info) return { error: "This link is invalid or has expired." };

  const form = await request.formData();
  const password = String(form.get("password") ?? "");
  const pwError = validatePassword(password);
  if (pwError) return { error: pwError };

  const ok = await consumePasswordResetToken(params.token, password);
  if (!ok) return { error: "This link is invalid or has expired." };

  const cookie = createSession(info.userId);
  throw redirect("/w", { headers: { "Set-Cookie": cookie } });
}

export default function ResetPassword() {
  const { valid } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state === "submitting";

  if (!valid) {
    return (
      <AuthForm title="Link expired">
        <p style={{ margin: 0, fontSize: "var(--fs-sm)", opacity: 0.6, textAlign: "center", lineHeight: 1.6 }}>
          This link is invalid or has expired. Ask an administrator for a new one.
        </p>
        <p style={{ margin: "1rem 0 0", fontSize: "var(--fs-xs)", opacity: 0.5, textAlign: "center" }}>
          <a href="/login" style={{ color: "var(--fg)" }}>Back to sign in</a>
        </p>
      </AuthForm>
    );
  }

  return (
    <AuthForm title="Set your password" error={result?.error}>
      <Form method="post" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <Field label="New password" name="password" type="password" autoComplete="new-password" />
        <SubmitButton disabled={busy}>
          {busy ? "Saving…" : "Set password"}
        </SubmitButton>
      </Form>
    </AuthForm>
  );
}
