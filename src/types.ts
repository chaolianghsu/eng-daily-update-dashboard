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

export interface DashboardData {
  rawData: Record<string, Record<string, MemberHours>>;
  issues: Issue[];
  leave: Record<string, LeaveRange[]>;
  commitData: CommitData | null;
  taskAnalysisData: TaskAnalysisData | null;
}

export type LoadData = () => Promise<DashboardData>;

export interface StatusInfo {
  label: string;
  color: string;
  bg: string;
}
