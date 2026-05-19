import { LogoIcon } from "./icons";

/** Reusable centered card for login / signup forms */
export function AuthForm({
  title,
  error,
  children,
}: {
  title?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100dvh",
        padding: "2rem 1.5rem",
      }}
    >
      <div style={{ width: "100%", maxWidth: "24rem" }}>
        {/* Wordmark */}
        <div style={{ marginBottom: "2.5rem" }}>
          <a
            href="/"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.5rem",
              textDecoration: "none",
            }}
          >
            <LogoIcon style={{ width: "auto", height: "1.5rem" }} />
            <span
              style={{
                fontWeight: 700,
                fontSize: "1.5rem",
                letterSpacing: "-0.03em",
                color: "var(--fg)",
              }}
            >
              loica
            </span>
          </a>
        </div>

        {title && (
          <h1
            style={{
              fontSize: "1rem",
              fontWeight: 700,
              margin: "0 0 2rem",
            }}
          >
            {title}
          </h1>
        )}

        {/* Error banner */}
        {error && (
          <div
            role="alert"
            style={{
              padding: "0.625rem 0.875rem",
              marginBottom: "1rem",
              background:
                "color-mix(in srgb, var(--color-scarlet) 15%, transparent)",
              border:
                "1px solid color-mix(in srgb, var(--color-scarlet) 40%, transparent)",
              borderRadius: "var(--radius-md)",
              fontSize: "0.8rem",
              color: "var(--fg)",
            }}
          >
            {error}
          </div>
        )}

        {children}
      </div>
    </div>
  );
}

/** Styled input field */
export function Field({
  label,
  name,
  type = "text",
  autoComplete,
  required = true,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  required?: boolean;
}) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.375rem",
        fontSize: "0.8rem",
      }}
    >
      <span style={{ opacity: 0.6 }}>{label}</span>
      <input
        name={name}
        type={type}
        autoComplete={autoComplete}
        required={required}
        className="auth-field-input"
      />
    </label>
  );
}

/** Primary submit button */
export function SubmitButton({
  children,
  disabled,
}: {
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="submit"
      disabled={disabled}
      style={{
        width: "100%",
        padding: "0.625rem 1rem",
        fontSize: "0.875rem",
        fontWeight: 700,
        background: "var(--fg)",
        color: "var(--bg)",
        border: "none",
        borderRadius: "var(--radius-md)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "opacity var(--ease-out), transform var(--ease-out)",
      }}
    >
      {children}
    </button>
  );
}
