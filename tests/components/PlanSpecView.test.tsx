// tests/components/PlanSpecView.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock("recharts", () => import("../__mocks__/recharts"));

import PlanSpecView from '../../src/PlanSpecView';
import type { PlanAnalysisData } from '../../src/types';

const mockData: PlanAnalysisData = {
  analysisDate: '2026-03-25',
  period: '3/24',
  planSpecs: [{
    date: '3/24', member: '哲緯',
    commit: { title: 'docs: API design', sha: 'abc123', project: 'bigdata/api', url: '', source: 'gitlab' as const },
    files: ['docs/specs/api.md'],
  }],
  correlations: [{
    date: '3/24', member: '哲緯',
    status: 'matched' as const,
    specCommits: 1,
    dailyUpdateMention: true,
    matchedTasks: ['API 設計'],
    unmatchedSpecs: [],
    reasoning: 'OK',
  }],
  summary: {
    totalSpecCommits: 1,
    totalCorrelations: 1,
    membersWithSpecs: 1,
    matched: 1,
    unmatched: 0,
    partial: 0,
  },
};

const baseProps = {
  planAnalysisData: mockData,
  members: ['哲緯'],
  memberColors: { '哲緯': '#06b6d4' },
  dates: ['3/24'],
  activeDate: '3/24',
  onDateSelect: vi.fn(),
};

describe('PlanSpecView', () => {
  it('renders summary cards with correct counts', () => {
    render(<PlanSpecView {...baseProps} />);
    // Should have labels for the summary
    expect(screen.getByText('規劃文件 Commits')).toBeInTheDocument();
    expect(screen.getByText('已匹配')).toBeInTheDocument();
    expect(screen.getByText('未匹配')).toBeInTheDocument();
  });

  it('renders correlation status for activeDate', () => {
    render(<PlanSpecView {...baseProps} />);
    // Member appears in both correlation table and spec detail
    expect(screen.getAllByText('哲緯').length).toBeGreaterThanOrEqual(1);
    // Should show matched status icon
    expect(screen.getByText('✅')).toBeInTheDocument();
  });

  it('renders spec commit details', () => {
    render(<PlanSpecView {...baseProps} />);
    // Should show the commit title
    expect(screen.getByText('docs: API design')).toBeInTheDocument();
    // Should show the spec file
    expect(screen.getByText('docs/specs/api.md')).toBeInTheDocument();
  });

  it('shows empty state when no planSpecs data', () => {
    const emptyData: PlanAnalysisData = {
      ...mockData,
      planSpecs: [],
      correlations: [],
      summary: { ...mockData.summary, totalSpecCommits: 0, totalCorrelations: 0, membersWithSpecs: 0, matched: 0, unmatched: 0, partial: 0 },
    };
    render(<PlanSpecView {...baseProps} planAnalysisData={emptyData} />);
    expect(screen.getByText('無規劃文件')).toBeInTheDocument();
  });

  it('renders unmatched status correctly', () => {
    const unmatchedData: PlanAnalysisData = {
      ...mockData,
      correlations: [{
        date: '3/24', member: '哲緯',
        status: 'unmatched' as const,
        specCommits: 1,
        dailyUpdateMention: false,
        matchedTasks: [],
        unmatchedSpecs: ['docs/specs/api.md'],
        reasoning: 'Daily update 未提及規劃文件',
      }],
      summary: { ...mockData.summary, matched: 0, unmatched: 1 },
    };
    render(<PlanSpecView {...baseProps} planAnalysisData={unmatchedData} />);
    expect(screen.getByText('🔴')).toBeInTheDocument();
  });
});
