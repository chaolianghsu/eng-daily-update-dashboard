// src/constants.ts
export const COLORS = {
  bg: "#0f172a", card: "#1e293b", border: "#334155",
  text: "#e2e8f0", textMuted: "#94a3b8", textDim: "#64748b",
  accent: "#3b82f6", accentLight: "#60a5fa",
  green: "#22c55e", greenDim: "#166534",
  yellow: "#eab308", yellowDim: "#854d0e",
  red: "#ef4444", redDim: "#991b1b",
  orange: "#f97316", orangeDim: "#7c2d12",
  purple: "#a78bfa",
  teal: "#06b6d4", tealDim: "#164e63",
} as const;

export const SEVERITY_COLORS: Record<string, { sc: string; bg: string }> = {
  "\u{1F534}": { sc: COLORS.red, bg: COLORS.redDim },
  "\u{1F7E1}": { sc: COLORS.yellow, bg: COLORS.yellowDim },
  "\u{1F7E0}": { sc: COLORS.orange, bg: COLORS.orangeDim },
  "\u{1F7E2}": { sc: COLORS.green, bg: COLORS.greenDim },
};

export const THRESHOLDS = { overtime: 10, high: 8.5, target: 8, ok: 6.5, low: 5 } as const;
export const MEETING_HEAVY_PCT = 50;

export const WEEK_DAYS = ["日", "一", "二", "三", "四", "五", "六"];

export const MEMBER_PALETTE = [
  "#f472b6", "#a78bfa", "#60a5fa", "#34d399", "#fbbf24",
  "#fb923c", "#22d3ee", "#c084fc", "#4ade80", "#f87171",
  "#38bdf8", "#a3a3a3", "#e879f9", "#facc15", "#2dd4bf", "#f43f5e",
];

export const PROJECT_PALETTE = [
  "#06b6d4", "#22c55e", "#f59e0b", "#ef4444", "#a78bfa",
  "#ec4899", "#f97316", "#14b8a6", "#6366f1", "#84cc16",
];

export const HEALTH_THRESHOLDS = {
  extremeLow: 4,
  extremeHigh: 11,
  consecutiveLowDays: 3,
  meetingHeavyPct: 60,
  consecutiveUnreportedDays: 2,
  rollingWindowDays: 20,
  madMultiplier: 2,
  madToSigma: 1.4826,
  minDataPoints: 5,
} as const;
