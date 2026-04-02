// src/types.ts
export interface MemberHours {
  total: number | null;
  meeting: number | null;
  dev: number | null;
  status: 'reported' | 'unreported' | 'replied_no_hours' | 'zero' | 'leave';
}

export interface Issue {
  member: string;
  severity: string;
  text: string;
  source?: "threshold" | "trend";
}

export interface LeaveRange {
  start: string;
  end: string;
}

export interface CommitItem {
  title: string;
  sha: string;
  project: string;
  url: string;
  datetime?: string;
  source?: 'gitlab' | 'github';
}

export interface MemberCommits {
  count: number;
  projects: string[];
  items: CommitItem[];
}

export interface CommitAnalysis {
  status: string;
  commitCount: number;
  hours: number | null;
}

export interface CommitData {
  commits: Record<string, Record<string, MemberCommits>>;
  analysis: Record<string, Record<string, CommitAnalysis>>;
  projectRisks: Array<{ project: string; soloContributor: string; severity: string }>;
}

export interface TaskWarning {
  date: string;
  member: string;
  severity: string;
  type: string;
  task: string;
  commits: string;
  reasoning: string;
}

export interface TaskAnalysisData {
  analysisDate: string;
  period: string;
  warnings: TaskWarning[];
  summary: {
    totalWarnings: number;
    critical: number;
    warning: number;
    caution: number;
    byType?: Record<string, number>;
  };
}

export interface PlanSpecItem {
  date: string;
  member: string;
  commit: {
    title: string;
    sha: string;
    project: string;
    url: string;
    source: 'gitlab' | 'github';
  };
  files: string[];
}

export interface PlanCorrelation {
  date: string;
  member: string;
  status: 'matched' | 'unmatched' | 'partial';
  specCommits: number;
  dailyUpdateMention: boolean;
  matchedTasks: string[];
  unmatchedSpecs: string[];
  reasoning: string;
}

export interface PlanAnalysisData {
  analysisDate: string;
  period: string;
  planSpecs: PlanSpecItem[];
  correlations?: PlanCorrelation[];
  summary: {
    totalSpecCommits: number;
    totalCorrelations: number;
    membersWithSpecs: number;
    matched: number;
    unmatched: number;
    partial: number;
  };
}

export interface DashboardData {
  rawData: Record<string, Record<string, MemberHours>>;
  issues: Issue[];
  leave: Record<string, LeaveRange[]>;
  commitData: CommitData | null;
  taskAnalysisData: TaskAnalysisData | null;
  planAnalysisData: PlanAnalysisData | null;
}

export type LoadData = () => Promise<DashboardData>;

export interface StatusInfo {
  label: string;
  color: string;
  bg: string;
}

export interface HealthAlert {
  member: string;
  severity: "🔴" | "🟡" | "🟠";
  text: string;
  source: "threshold" | "trend";
  type: "low_hours" | "high_hours" | "consecutive_low" | "meeting_heavy" |
        "unreported" | "hours_drop" | "hours_spike" | "meeting_spike" | "commit_drop";
}

export interface MemberProfile {
  hoursTrend: Array<{ date: string; total: number | null; meeting: number | null; dev: number | null; status: "normal" | "warning" | "danger" }>;
  baseline: number | null;
  recentAvg: number | null;
  meetingPct: number | null;
  consistencyGrid: Array<{ date: string; status: "✅" | "⚠️" | "🔴" | null }>;
  consistencyRate: number;
  projectDistribution: Array<{ project: string; count: number; pct: number }>;
  totalCommits: number;
  recentCommits: number;
  prevCommits: number;
  weeklyMeetingPct: Array<{ week: string; pct: number }>;
  taskWarnings: Array<{ date: string; severity: string; type: string; task: string; reasoning: string }>;
}
