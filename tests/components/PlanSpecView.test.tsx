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
    commit: { title: 'docs: API design', sha: 'abc123', project: 'bigdata/api', url: 'https://biglab.buygta.today/bigdata/api/-/commit/abc123', source: 'gitlab' as const },
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
    // Should show the spec file (filename only, full path in title)
    expect(screen.getByText('api.md')).toBeInTheDocument();
  });

  it('renders file as blob link with correct href', () => {
    render(<PlanSpecView {...baseProps} />);
    const fileLink = screen.getByRole('link', { name: /api\.md/ });
    expect(fileLink).toHaveAttribute('href', 'https://biglab.buygta.today/bigdata/api/-/blob/abc123/docs/specs/api.md');
    expect(fileLink).toHaveAttribute('target', '_blank');
    expect(fileLink).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('renders diff icon link pointing to commit URL', () => {
    render(<PlanSpecView {...baseProps} />);
    const diffLink = screen.getByRole('link', { name: '↔' });
    expect(diffLink).toHaveAttribute('href', 'https://biglab.buygta.today/bigdata/api/-/commit/abc123');
    expect(diffLink).toHaveAttribute('target', '_blank');
    expect(diffLink).toHaveAttribute('title', '查看 diff');
  });

  it('shows filename only in link text with full path as tooltip', () => {
    render(<PlanSpecView {...baseProps} />);
    const fileLink = screen.getByRole('link', { name: /api\.md/ });
    expect(fileLink).toHaveTextContent('api.md');
    expect(fileLink).toHaveAttribute('title', 'docs/specs/api.md');
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
