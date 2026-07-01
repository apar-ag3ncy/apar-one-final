import React, { CSSProperties, ReactNode } from "react";

/**
 * Apar OS icon set — ported VERBATIM from src/components/os/icons.tsx so the
 * video uses the exact same glyphs as the product dock.
 */
export type IconName =
  | "building"
  | "truck"
  | "folder"
  | "users"
  | "inbox"
  | "book"
  | "chart"
  | "settings"
  | "search"
  | "user"
  | "filetext"
  | "check"
  | "star"
  | "bell"
  | "shield"
  | "palette"
  | "globe"
  | "zap"
  | "trash"
  | "edit"
  | "alert";

const ICONS: Record<IconName, ReactNode> = {
  building: (
    <>
      <rect x="3" y="3" width="14" height="18" rx="1" />
      <path d="M17 8h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" />
      <path d="M7 7h2" />
      <path d="M11 7h2" />
      <path d="M7 11h2" />
      <path d="M11 11h2" />
      <path d="M7 15h2" />
      <path d="M11 15h2" />
    </>
  ),
  truck: (
    <>
      <path d="M14 18V6a1 1 0 0 0-1-1H2v13" />
      <path d="M14 8h4l4 4v6h-8" />
      <circle cx="7" cy="18" r="2" />
      <circle cx="17" cy="18" r="2" />
    </>
  ),
  folder: (
    <>
      <path d="M4 5h5l2 3h9v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />
      <path d="M8 13v4M12 11v6M16 13v4" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="4" />
      <path d="M3 21a6 6 0 0 1 12 0" />
      <path d="M16 4a4 4 0 0 1 0 8" />
      <path d="M17 12a6 6 0 0 1 4 6" />
    </>
  ),
  inbox: (
    <>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" />
    </>
  ),
  book: (
    <>
      <path d="M12 7v14" />
      <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3Z" />
    </>
  ),
  chart: (
    <>
      <path d="M3 3v18h18" />
      <rect x="7" y="13" width="3" height="5" />
      <rect x="12" y="9" width="3" height="9" />
      <rect x="17" y="5" width="3" height="13" />
    </>
  ),
  settings: (
    <>
      <path d="M20 7h-9" />
      <path d="M14 17H5" />
      <circle cx="17" cy="17" r="3" />
      <circle cx="7" cy="7" r="3" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  filetext: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M8 13h8M8 17h6" />
    </>
  ),
  check: <path d="m5 12 5 5L20 7" />,
  star: <path d="m12 2 3 7h7l-5.5 4.5L18.5 21 12 16.5 5.5 21 7.5 13.5 2 9h7Z" />,
  bell: (
    <>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10 21a2 2 0 0 0 4 0" />
    </>
  ),
  shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />,
  palette: (
    <>
      <circle cx="13.5" cy="6.5" r="1" />
      <circle cx="17.5" cy="10.5" r="1" />
      <circle cx="8.5" cy="7.5" r="1" />
      <circle cx="6.5" cy="12.5" r="1" />
      <path d="M12 22a10 10 0 1 1 10-10c0 4-3 6-6 6h-2a2 2 0 0 0-2 2v.5a3.5 3.5 0 0 1-0 1.5" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20" />
    </>
  ),
  zap: <path d="M13 2 4 14h7l-1 8 9-12h-7z" />,
  trash: (
    <>
      <path d="M3 6h18" />
      <path d="M19 6 18 20a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </>
  ),
  edit: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </>
  ),
  alert: (
    <>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </>
  ),
};

export function OsIcon({
  name,
  size = 16,
  stroke = 1.6,
  color = "currentColor",
  style,
}: {
  name: IconName;
  size?: number;
  stroke?: number;
  color?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      aria-hidden
    >
      {ICONS[name]}
    </svg>
  );
}

/** The real Apar OS app registry (id, label, icon, accent) — from data.ts. */
export const OS_APPS: { id: string; name: string; icon: IconName; accent: string }[] = [
  { id: "clients", name: "Clients", icon: "building", accent: "#E63A1F" },
  { id: "vendors", name: "Vendors", icon: "truck", accent: "#C46A28" },
  { id: "projects", name: "Projects", icon: "folder", accent: "#D08A1E" },
  { id: "employees", name: "Employees", icon: "users", accent: "#2E8F5A" },
  { id: "attendance", name: "Attendance", icon: "check", accent: "#3F4E8E" },
  { id: "inbox", name: "Inbox", icon: "inbox", accent: "#B5391E" },
  { id: "ledger", name: "Ledger", icon: "book", accent: "#5B6677" },
  { id: "reports", name: "Reports", icon: "chart", accent: "#2E8F5A" },
  { id: "office", name: "Office", icon: "zap", accent: "#C46A28" },
  { id: "settings", name: "Settings", icon: "settings", accent: "#7A4E2D" },
  { id: "admin_console", name: "Admin Console", icon: "shield", accent: "#ee3a24" },
];
