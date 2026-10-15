import { useState, useEffect, useMemo } from "react";
import { useSubmit } from "react-router";
import { Menu, MenuAlign, type MenuEntry } from "~/components/Menu";
import { GroupIcon, LogOutIcon, MoonIcon, SettingsIcon, ShieldIcon, SunIcon } from "~/components/icons";
import { currentTheme, toggleTheme, type Theme } from "~/lib/theme";

const AVATAR_COLORS = [
  "#AF3029", // red // allow-hex: per-user avatar hue
  "#DA702C", // orange // allow-hex: per-user avatar hue
  "#D0A215", // yellow // allow-hex: per-user avatar hue
  "#66800B", // green // allow-hex: per-user avatar hue
  "#205EA6", // blue // allow-hex: per-user avatar hue
  "#5E409D", // purple // allow-hex: per-user avatar hue
  "#A02F6F", // magenta // allow-hex: per-user avatar hue
  "#24837B", // cyan // allow-hex: per-user avatar hue
];

function avatarColor(name: string): string {
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return (parts[0]?.[0] ?? "?").toUpperCase();
}

interface UserMenuProps {
  userName: string;
  isAdmin?: boolean;
}

export function UserMenu({ userName, isAdmin }: UserMenuProps) {
  const submit = useSubmit();

  // Read on mount only — localStorage/matchMedia are client-only, so reading
  // during render would mismatch the SSR markup. null until hydrated.
  const [theme, setThemeState] = useState<Theme | null>(null);
  useEffect(() => setThemeState(currentTheme()), []);

  const color = useMemo(() => avatarColor(userName), [userName]);
  const initials = getInitials(userName);

  const iconClass = "h-4 w-4";

  const entries: MenuEntry[] = [
    {
      kind: "header",
      label: userName,
      leading: (
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[length:var(--fs-xs)] font-semibold"
          style={{ background: color, color: "#fff" /* allow-hex: avatar initials on colored fill */ }}
        >
          {initials}
        </span>
      ),
    },
    { kind: "separator" },
    { kind: "item", label: "Settings", icon: <SettingsIcon className={iconClass} />, href: "/settings" },
  ];

  if (theme !== null) {
    const toDark = theme !== "dark";
    entries.push({
      kind: "item",
      label: toDark ? "Dark mode" : "Light mode",
      hint: toDark ? "Switch to the Dracula theme" : "Switch to the light theme",
      icon: toDark ? <MoonIcon className={iconClass} /> : <SunIcon className={iconClass} />,
      onSelect: () => setThemeState(toggleTheme()),
    });
  }

  if (isAdmin) {
    entries.push(
      { kind: "separator" },
      { kind: "item", label: "Teamspaces", icon: <GroupIcon className={iconClass} />, href: "/teamspaces" },
      { kind: "item", label: "Admin panel", icon: <ShieldIcon className={iconClass} />, href: "/admin" },
    );
  }

  entries.push(
    { kind: "separator" },
    {
      kind: "item",
      label: "Sign out",
      icon: <LogOutIcon className={iconClass} />,
      tone: "quiet",
      onSelect: () => submit(null, { method: "post", action: "/logout" }),
    },
  );

  return (
    <Menu
      align={MenuAlign.End}
      entries={entries}
      renderTrigger={({ ref, ...triggerProps }, open) => (
        <button
          ref={ref}
          type="button"
          {...triggerProps}
          style={{
            width: "28px",
            height: "28px",
            borderRadius: "50%",
            border: "none",
            background: color,
            color: "#fff", // allow-hex: avatar initials on colored fill
            fontSize: initials.length > 1 ? "0.6rem" : "0.75rem",
            fontWeight: 600,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            lineHeight: 1,
            opacity: open ? 1 : 0.85,
            transition: "opacity 0.15s",
          }}
          title={userName}
        >
          {initials}
        </button>
      )}
    />
  );
}
