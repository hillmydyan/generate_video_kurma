// Timezone: Asia/Jakarta (WIB)
export const APP_TZ = "Asia/Jakarta";

export const STATUS_META = {
  queued: { label: "Queued", badgeClass: "badge-queued", icon: "hourglass_empty" },
  generating: { label: "Generating", badgeClass: "badge-generating", icon: "sync" },
  downloading: { label: "Downloading", badgeClass: "badge-downloading", icon: "downloading" },
  completed: { label: "Completed", badgeClass: "badge-completed", icon: "check_circle" },
  failed: { label: "Failed", badgeClass: "badge-failed", icon: "error" },
} as const;

export type TaskStatus = keyof typeof STATUS_META;

/**
 * Parse server date (assumed UTC or naive WIB) and ensure Date object
 */
export function parseServerDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;
  // If no timezone suffix, append +07:00 as per PRD line 649
  let s = dateStr.trim();
  if (!s.endsWith("Z") && !s.includes("+") && !s.includes("-", 10)) {
    s += "+07:00";
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

export function fmtTime(date: Date | string | null | undefined): string {
  const d = typeof date === "string" ? parseServerDate(date) : date;
  if (!d) return "--:--:--";
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: APP_TZ,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d);
}

export function fmtLocal(date: Date | string | null | undefined): string {
  const d = typeof date === "string" ? parseServerDate(date) : date;
  if (!d) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: APP_TZ,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

export function fmtAgo(date: Date | string | null | undefined): string {
  const d = typeof date === "string" ? parseServerDate(date) : date;
  if (!d) return "-";
  const now = new Date();
  const diffSec = Math.floor((now.getTime() - d.getTime()) / 1000);

  if (diffSec < 5) return "baru saja";
  if (diffSec < 60) return `${diffSec} dtk lalu`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} mnt lalu`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} jam lalu`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay} hari lalu`;
}

export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds == null || isNaN(seconds) || seconds < 0) return "0s";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const remSec = s % 60;
  if (m < 60) {
    return remSec > 0 ? `${m}m ${remSec}s` : `${m}m`;
  }
  const h = Math.floor(m / 60);
  const remMin = m % 60;
  return remMin > 0 ? `${h}j ${remMin}m` : `${h}j`;
}

export function fmtCredits(amount: number | null | undefined): string {
  if (amount == null || isNaN(amount)) return "0 KR";
  return `${amount.toLocaleString("id-ID")} KR`;
}

export function fmtBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export function fmtCountdown(remainingSeconds: number): string {
  if (remainingSeconds <= 0) return "00:00";
  const m = Math.floor(remainingSeconds / 60);
  const s = Math.floor(remainingSeconds % 60);
  return `${pad2(m)}:${pad2(s)}`;
}

export function initials(name: string | null | undefined): string {
  if (!name) return "U";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function truncate(text: string | null | undefined, maxLen: number = 60): string {
  if (!text) return "";
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + "…";
}

export function fmtSecAgo(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)} dtk lalu`;
  return `${Math.floor(seconds / 60)} mnt lalu`;
}

export function fmtLeft(seconds: number): string {
  return `sisa ≈ ${fmtDuration(seconds)}`;
}

