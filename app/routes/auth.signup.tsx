import { Form, redirect, useActionData, useNavigation, useLoaderData } from "react-router";
import type { MetaFunction } from "react-router";
import type { Route } from "./+types/auth.signup";
import { AuthForm, Field, SubmitButton } from "~/components/AuthForm";
import { getSessionUser, createUser, createSession, validatePassword } from "~/lib/auth.server";
import { createWorkspace, getUserWorkspaces } from "~/lib/workspace.server";
import { createDocument, updateDocument } from "~/lib/document.server";
import { isRegistrationOpen, isLocalLoginEnabled } from "~/lib/db.server";
import { getActiveAuthProviders } from "~/extensions/index.server";
import { checkRateLimit, getClientIp } from "~/lib/rate-limit.server";

const WELCOME_CONTENT = `# Welcome to Loica!

Thanks for creating an account. Here's a quick tour of what ships in the box.

## Writing

A plain Markdown editor with a toolbar and keyboard shortcuts:

- **Bold** \`Ctrl+B\` · *Italic* \`Ctrl+I\` · \`Inline code\` \`Ctrl+\\\`\` · [Links]() \`Ctrl+K\`
- Headings (H1–H4), ordered and unordered lists, blockquotes, code blocks, tables, footnotes, horizontal rules
- Paste or drag in **images** — they upload and embed automatically
- Pasting rich text from another app converts it to Markdown

## Real-time Collaboration

Open the same document in two tabs and edit. Changes sync instantly via CRDT, so nothing is lost even on flaky connections. Coloured **presence dots** show everyone currently viewing or editing.

## Sharing

- **Per-document links** — generate a view-only or collaborative-edit link from the Share button. Edit-link visitors join as guests with a random name.
- **Folder sharing** — share an entire folder with specific users or groups; recipients see it in their *Shared with me* view.
- **Pending invites** appear as notifications recipients can accept or decline.

## Comments & Suggestions

- **Comments** — select text, press \`Ctrl+Shift+C\`. \`@\`-mention people to notify them. Comments appear in the side panel, colour-coded per author.
- **Track changes** via CriticMarkup: \`Ctrl+Shift+A\` to suggest an insertion, \`Ctrl+Shift+D\` a deletion, \`Ctrl+Shift+S\` a substitution. Reviewers accept or reject each one.

## Organising your work

- **Folders & subfolders** — drag and drop documents and folders to rearrange.
- **Bulk select** — Ctrl/Cmd-click multiple docs to delete or unshare in one go.
- **Favorites** ⭐ — star any doc; *Favorites* in the sidebar lists them.
- **Recent** — quickly jump back to docs you opened recently.
- **Trash** — deleted docs go to Trash and can be restored or purged.
- **Search** — \`Ctrl+K\` (or \`Cmd+K\`) opens full-text search across your workspace.

## Workspaces & Teamspaces

Your **personal workspace** is private. Create a **teamspace** for shared work — invite members, give them a role (owner, editor, or viewer), and collaborate on documents and folders together.

## Groups

Create **user groups** to share with many people at once. Adding a group to a folder share grants access to every member; group admins can add or remove members.

## Version History

Every document keeps a full history:

- **Auto-saves** every 30 minutes during active editing
- **Manual saves** with a custom label
- **Word-level diff** preview between any two versions
- **Restore** to any previous version in one click

## Export

- Download a single document as a **.md** file from the actions menu
- Export an entire workspace as a **.zip** of Markdown files preserving folder structure

## Settings & Admin

Update your name, email, and password from **Settings**. The first user to sign up is the **admin** and can manage users, workspaces, app-level settings, and toggle extensions from \`/admin\`.

---

Feel free to edit or delete this document. Happy writing!
`;

export const meta: MetaFunction = () => [{ title: "Sign up — loica" }];

export async function loader({ request }: Route.LoaderArgs) {
  if (getSessionUser(request)) throw redirect("/");
  return {
    registrationOpen: isRegistrationOpen(),
    authProviders: getActiveAuthProviders(),
    localLoginEnabled: isLocalLoginEnabled(),
  };
}

export async function action({ request }: Route.ActionArgs) {
  if (!isRegistrationOpen()) {
    return { error: "Registration is currently closed." };
  }

  const ip = getClientIp(request);
  const { allowed, retryAfterSeconds } = checkRateLimit(ip, {
    windowMs: 60 * 60 * 1000,
    max: 5,
  });
  if (!allowed) {
    return { error: `Too many signup attempts. Please try again in ${retryAfterSeconds} seconds.` };
  }

  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");

  if (!name || !email || !password) {
    return { error: "All fields are required." };
  }
  const pwError = validatePassword(password);
  if (pwError) {
    return { error: pwError };
  }

  let userId: string;
  try {
    userId = await createUser(email, name, password);
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "email_taken") {
      return { error: "An account with that email already exists." };
    }
    throw err;
  }

  // Auto-create personal workspace
  const workspace = createWorkspace("My documents", userId);

  // Create a welcome document for the new user
  const welcomeDoc = createDocument(workspace.id, userId, "Welcome to Loica");
  updateDocument(welcomeDoc.id, { content: WELCOME_CONTENT });

  const cookie = createSession(userId);
  throw redirect("/w", { headers: { "Set-Cookie": cookie } });
}

export default function Signup() {
  const { registrationOpen, authProviders, localLoginEnabled } =
    useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state === "submitting";

  // When local login is off but at least one auth provider is active,
  // direct people to the provider — there's no email/password flow to show.
  if (authProviders.length > 0 && !localLoginEnabled) {
    const provider = authProviders[0]!;
    return (
      <AuthForm title="Create an account" error={undefined}>
        <p
          style={{
            margin: "0 0 1.5rem",
            fontSize: "0.85rem",
            opacity: 0.6,
            textAlign: "center",
            lineHeight: 1.6,
          }}
        >
          Accounts are managed via your identity provider. Sign in and your
          Loica account will be created automatically.
        </p>
        <a
          href={provider.loginPath}
          style={{
            display: "block",
            width: "100%",
            padding: "0.5rem 1rem",
            fontSize: "0.875rem",
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
          {provider.label}
        </a>
        <p style={{ margin: "1rem 0 0", fontSize: "0.8rem", opacity: 0.5, textAlign: "center" }}>
          Already have an account?{" "}
          <a href="/login" style={{ color: "var(--fg)" }}>
            Sign in
          </a>
        </p>
      </AuthForm>
    );
  }

  if (!registrationOpen) {
    return (
      <AuthForm title="Registration closed" error={undefined}>
        <p style={{ margin: 0, fontSize: "0.85rem", opacity: 0.6, textAlign: "center", lineHeight: 1.6 }}>
          New account registration is currently closed. Contact an administrator for access.
        </p>
        <p style={{ margin: 0, fontSize: "0.8rem", opacity: 0.5, textAlign: "center" }}>
          Already have an account?{" "}
          <a href="/login" style={{ color: "var(--fg)" }}>
            Sign in
          </a>
        </p>
      </AuthForm>
    );
  }

  return (
    <AuthForm title="Create an account" error={result?.error}>
      <Form method="post" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <Field label="Name" name="name" autoComplete="name" />
        <Field label="Email" name="email" type="email" autoComplete="email" />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
        />

        <SubmitButton disabled={busy}>
          {busy ? "Creating account…" : "Create account"}
        </SubmitButton>

        <p style={{ margin: 0, fontSize: "0.8rem", opacity: 0.5, textAlign: "center" }}>
          Already have an account?{" "}
          <a href="/login" style={{ color: "var(--fg)" }}>
            Sign in
          </a>
        </p>
      </Form>
    </AuthForm>
  );
}
