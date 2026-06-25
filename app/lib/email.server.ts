// ─── Email transport ─────────────────────────────────────
//
// Loica is mail-provider agnostic. A transport is selected once, in order of
// precedence:
//
//   1. SMTP — any standard server. Set SMTP_HOST (+ optional SMTP_PORT / _USER /
//      _PASS / _SECURE). Works with Mailgun SMTP, Postfix, Gmail, Mailpit, a
//      platform mail addon, etc. This is the recommended, opinion-free path.
//   2. Mailgun REST API — set MAILGUN_API_KEY + MAILGUN_DOMAIN.
//   3. Console stub — neither configured (development default).
//
// The "from" address is EMAIL_FROM (preferred), falling back to SMTP_FROM, then
// MAILGUN_FROM for backward compatibility.

// SMTP config
const SMTP_HOST = process.env.SMTP_HOST ?? "";
const SMTP_PORT = Number(process.env.SMTP_PORT ?? 587);
const SMTP_USER = process.env.SMTP_USER ?? "";
const SMTP_PASS = process.env.SMTP_PASS ?? "";
// Implicit TLS (typically port 465). Otherwise STARTTLS is negotiated (587/25).
const SMTP_SECURE = process.env.SMTP_SECURE === "true" || SMTP_PORT === 465;

// Mailgun REST API config
const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY ?? "";
const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN ?? "";
const MAILGUN_FROM = process.env.MAILGUN_FROM ?? "noreply@example.com";
const MAILGUN_REGION = process.env.MAILGUN_REGION ?? "eu"; // "eu" or "us"

const EMAIL_FROM = process.env.EMAIL_FROM ?? process.env.SMTP_FROM ?? MAILGUN_FROM;

const transport: "smtp" | "mailgun" | "stub" =
  SMTP_HOST !== ""
    ? "smtp"
    : MAILGUN_API_KEY !== "" && MAILGUN_DOMAIN !== ""
      ? "mailgun"
      : "stub";

// Lazily constructed nodemailer transporter (only when SMTP is the transport),
// so nodemailer is never loaded when another transport is in use.
let _transporter: import("nodemailer").Transporter | null = null;
async function getTransporter(): Promise<import("nodemailer").Transporter> {
  if (_transporter) return _transporter;
  const nodemailer = await import("nodemailer");
  _transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  });
  return _transporter;
}

// ─── Core sender (fire-and-forget) ──────────────────────

async function sendEmail(
  to: string,
  toName: string,
  subject: string,
  html: string,
  text: string
): Promise<void> {
  if (transport === "stub") {
    console.log(`[email stub] To: ${to} (${toName}) — Subject: ${subject}`);
    return;
  }

  try {
    if (transport === "smtp") {
      const t = await getTransporter();
      await t.sendMail({
        from: EMAIL_FROM,
        to: { name: toName, address: to },
        subject,
        html,
        text,
      });
      return;
    }

    // Mailgun REST API
    console.log(`[email] Sending to ${to}, from: "${EMAIL_FROM}", domain: ${MAILGUN_DOMAIN}`);
    const params = new URLSearchParams();
    params.append("from", EMAIL_FROM);
    params.append("to", to);
    params.append("subject", subject);
    params.append("html", html);
    params.append("text", text);

    const host = MAILGUN_REGION === "eu" ? "api.eu.mailgun.net" : "api.mailgun.net";
    const resp = await fetch(
      `https://${host}/v3/${MAILGUN_DOMAIN}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`api:${MAILGUN_API_KEY}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params,
      }
    );

    if (!resp.ok) {
      const body = await resp.text();
      console.error(`[email] Mailgun error ${resp.status}: ${body}`);
    }
  } catch (err) {
    console.error("[email] failed to send to", to, "subject:", subject, err);
  }
}

// ─── HTML wrapper ────────────────────────────────────────

function wrap(title: string, body: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f2f2f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f2;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;">
        <tr>
          <td style="padding:28px 32px 20px;border-bottom:2px solid #AF3029;">
            <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 555 390'%3E%3Cpolygon fill='%23b4aba7' points='112.5 112.5 2.5 2.5 112.5 2.5'/%3E%3Cpath fill='%23432c23' d='M286.94,66.94C245.68,25.68,189.72,2.5,131.37,2.5h-18.87v110l220,220h220L286.94,66.94ZM195,57.5c0,15.19-12.31,27.5-27.5,27.5h0c-15.19,0-27.5-12.31-27.5-27.5h0c0-15.19,12.31-27.5,27.5-27.5h0c15.19,0,27.5,12.31,27.5,27.5h0Z'/%3E%3Cpath fill='%23ed1c24' d='M332.5,332.5H112.5c-60.75,0-110-49.25-110-110h0c0-60.75,49.25-110,110-110l220,220Z'/%3E%3Cpolygon fill='%23432c23' points='332.5 332.5 277.5 387.5 250 387.5 305 332.5'/%3E%3Cpolygon fill='%23432c23' points='250 332.5 195 387.5 167.5 387.5 222.5 332.5'/%3E%3C/svg%3E" alt="loica" width="28" height="20" style="display:inline-block;vertical-align:middle;margin-right:8px;" /><span style="color:#AF3029;font-size:22px;font-weight:800;letter-spacing:0.5px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;vertical-align:middle;">loica</span>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <h2 style="margin:0 0 20px;color:#1a1a1a;font-size:18px;font-weight:700;">${title}</h2>
            ${body}
          </td>
        </tr>
        <tr>
          <td style="padding:16px 32px;border-top:1px solid #eee;">
            <p style="margin:0;font-size:11px;color:#999;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;">loica</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── Public notification functions ───────────────────────

export function sendFolderShareNotification(
  toEmail: string,
  toName: string,
  folderName: string,
  sharedByName: string,
  siteUrl?: string
): void {
  const subject = `${sharedByName} shared a folder with you`;
  const link = siteUrl ? `${siteUrl}/shared` : null;
  const actionHtml = link
    ? `<p style="margin:0;">
        <a href="${link}" style="display:inline-block;padding:10px 20px;background:#AF3029;color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;">View invitation</a>
      </p>`
    : `<p style="margin:0;color:#333;font-size:14px;line-height:1.6;">
        Log in to view and accept the invitation.
      </p>`;
  const html = wrap(
    "Folder shared with you",
    `<p style="margin:0 0 12px;color:#333;font-size:14px;line-height:1.6;">
      <strong>${sharedByName}</strong> shared the folder <strong>&ldquo;${folderName}&rdquo;</strong> with you on Loica.
    </p>
    ${actionHtml}`
  );
  const actionText = link ? `View your invitation: ${link}` : "Log in to view and accept the invitation.";
  const text = `${sharedByName} shared the folder "${folderName}" with you on Loica. ${actionText}`;
  sendEmail(toEmail, toName, subject, html, text);
}

export function sendDocShareNotification(
  toEmail: string,
  toName: string,
  docTitle: string,
  sharedByName: string,
  docId?: string,
  siteUrl?: string,
  directAccess?: boolean
): void {
  const subject = `${sharedByName} shared a document with you`;
  const link = siteUrl && docId
    ? directAccess
      ? `${siteUrl}/w/doc/${docId}`
      : `${siteUrl}/shared/doc/${docId}`
    : null;
  const actionHtml = link
    ? `<p style="margin:0;">
        <a href="${link}" style="display:inline-block;padding:10px 20px;background:#AF3029;color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;">Open document</a>
      </p>`
    : `<p style="margin:0;color:#333;font-size:14px;line-height:1.6;">
        Log in to view and accept the invitation.
      </p>`;
  const html = wrap(
    "Document shared with you",
    `<p style="margin:0 0 12px;color:#333;font-size:14px;line-height:1.6;">
      <strong>${sharedByName}</strong> shared the document <strong>&ldquo;${docTitle}&rdquo;</strong> with you on Loica.
    </p>
    ${actionHtml}`
  );
  const actionText = link ? `Open the document: ${link}` : "Log in to view and accept the invitation.";
  const text = `${sharedByName} shared the document "${docTitle}" with you on Loica. ${actionText}`;
  sendEmail(toEmail, toName, subject, html, text);
}

export function sendExternalShareNotification(
  toEmail: string,
  docTitle: string,
  sharedByName: string,
  editLink: string
): void {
  const subject = `${sharedByName} shared a document with you`;
  const html = wrap(
    "Document shared with you",
    `<p style="margin:0 0 12px;color:#333;font-size:14px;line-height:1.6;">
      <strong>${sharedByName}</strong> shared the document <strong>&ldquo;${docTitle}&rdquo;</strong> with you on Loica.
    </p>
    <p style="margin:0;">
      <a href="${editLink}" style="display:inline-block;padding:10px 20px;background:#AF3029;color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;">Open document</a>
    </p>`
  );
  const text = `${sharedByName} shared the document "${docTitle}" with you on Loica. Open the document: ${editLink}`;
  sendEmail(toEmail, toEmail, subject, html, text);
}

export function sendWelcomeEmail(
  toEmail: string,
  toName: string,
  temporaryPassword: string
): void {
  const subject = "Welcome to Loica";
  const html = wrap(
    `Welcome, ${toName}!`,
    `<p style="margin:0 0 12px;color:#333;font-size:14px;line-height:1.6;">
      An account has been created for you on Loica.
    </p>
    <p style="margin:0 0 8px;color:#333;font-size:14px;line-height:1.6;">
      Your temporary password is:
    </p>
    <p style="margin:0 0 16px;padding:12px 16px;background:#f5f5f5;border:1px solid #e0e0e0;border-radius:6px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:16px;color:#1a1a1a;">
      ${temporaryPassword}
    </p>
    <p style="margin:0;color:#333;font-size:14px;line-height:1.6;">
      Please log in and change your password in Settings.
    </p>`
  );
  const text = `Welcome to Loica, ${toName}! Your temporary password is: ${temporaryPassword} — Please log in and change your password in Settings.`;
  sendEmail(toEmail, toName, subject, html, text);
}

export function sendGroupInviteNotification(
  toEmail: string,
  toName: string,
  groupName: string,
  invitedByName: string,
  siteUrl?: string
): void {
  const subject = `${invitedByName} invited you to a group`;
  const inviteLink = siteUrl ? `${siteUrl}/groups` : null;
  const actionHtml = inviteLink
    ? `<p style="margin:0;">
        <a href="${inviteLink}" style="display:inline-block;padding:10px 20px;background:#AF3029;color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;">View invitation</a>
      </p>`
    : `<p style="margin:0;color:#333;font-size:14px;line-height:1.6;">
        Log in to accept or decline the invitation.
      </p>`;
  const html = wrap(
    "Group invitation",
    `<p style="margin:0 0 12px;color:#333;font-size:14px;line-height:1.6;">
      <strong>${invitedByName}</strong> invited you to the group <strong>&ldquo;${groupName}&rdquo;</strong> on Loica.
    </p>
    ${actionHtml}`
  );
  const actionText = inviteLink
    ? `View your invitation: ${inviteLink}`
    : "Log in to accept or decline the invitation.";
  const text = `${invitedByName} invited you to the group "${groupName}" on Loica. ${actionText}`;
  sendEmail(toEmail, toName, subject, html, text);
}

export function sendMentionNotification(
  toEmail: string,
  toName: string,
  mentionerName: string,
  documentTitle: string,
  commentBody: string,
  docUrl: string
): void {
  const subject = `${mentionerName} mentioned you in "${documentTitle}"`;
  // Strip mention markers for display
  const displayBody = commentBody.replace(/@\[(.+?)\]\(user:.+?\)/g, "@$1");
  const html = wrap(
    "You were mentioned in a comment",
    `<p style="margin:0 0 12px;color:#333;font-size:14px;line-height:1.6;">
      <strong>${mentionerName}</strong> mentioned you in a comment on <strong>&ldquo;${documentTitle}&rdquo;</strong>:
    </p>
    <p style="margin:0 0 16px;padding:12px 16px;background:#f5f5f5;border-left:3px solid #AF3029;border-radius:4px;font-size:14px;color:#333;line-height:1.6;">
      ${displayBody}
    </p>
    <p style="margin:0;">
      <a href="${docUrl}" style="display:inline-block;padding:10px 20px;background:#AF3029;color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;">Open document</a>
    </p>`
  );
  const text = `${mentionerName} mentioned you in a comment on "${documentTitle}": "${displayBody}" — ${docUrl}`;
  sendEmail(toEmail, toName, subject, html, text);
}

export function sendCommentNotification(
  toEmail: string,
  toName: string,
  commenterName: string,
  documentTitle: string,
  commentBody: string,
  docUrl: string
): void {
  const subject = `New comment on "${documentTitle}"`;
  const displayBody = commentBody.replace(/@\[(.+?)\]\(user:.+?\)/g, "@$1");
  const html = wrap(
    "New comment on your document",
    `<p style="margin:0 0 12px;color:#333;font-size:14px;line-height:1.6;">
      <strong>${commenterName}</strong> commented on <strong>&ldquo;${documentTitle}&rdquo;</strong>:
    </p>
    <p style="margin:0 0 16px;padding:12px 16px;background:#f5f5f5;border-left:3px solid #AF3029;border-radius:4px;font-size:14px;color:#333;line-height:1.6;">
      ${displayBody}
    </p>
    <p style="margin:0;">
      <a href="${docUrl}" style="display:inline-block;padding:10px 20px;background:#AF3029;color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;">Open document</a>
    </p>`
  );
  const text = `${commenterName} commented on "${documentTitle}": "${displayBody}" — ${docUrl}`;
  sendEmail(toEmail, toName, subject, html, text);
}

export function sendPasswordChangedNotification(
  toEmail: string,
  toName: string,
  newPassword: string
): void {
  const subject = "Your Loica password has been changed";
  const html = wrap(
    "Password changed",
    `<p style="margin:0 0 12px;color:#333;font-size:14px;line-height:1.6;">
      An administrator has changed your password on Loica.
    </p>
    <p style="margin:0 0 8px;color:#333;font-size:14px;line-height:1.6;">
      Your new password is:
    </p>
    <p style="margin:0 0 16px;padding:12px 16px;background:#f5f5f5;border:1px solid #e0e0e0;border-radius:6px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:16px;color:#1a1a1a;">
      ${newPassword}
    </p>
    <p style="margin:0;color:#333;font-size:14px;line-height:1.6;">
      Please log in and change your password in Settings.
    </p>`
  );
  const text = `Your Loica password has been changed by an administrator. Your new password is: ${newPassword} — Please log in and change it in Settings.`;
  sendEmail(toEmail, toName, subject, html, text);
}
