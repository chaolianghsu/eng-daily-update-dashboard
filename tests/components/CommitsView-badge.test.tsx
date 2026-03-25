import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock("recharts", () => import("../__mocks__/recharts"));

import CommitsView, { hasSpecFile } from '../../src/CommitsView';
import type { PlanSpecItem } from '../../src/types';

// --- Unit tests for hasSpecFile ---

describe('hasSpecFile', () => {
  it('returns true when sha matches', () => {
    const planSpecs: PlanSpecItem[] = [{
      date: '3/24', member: '哲緯',
      commit: { sha: 'abc12345', title: '', project: '', url: '', source: 'gitlab' },
      files: ['docs/spec.md'],
    }];
    expect(hasSpecFile('abc12345', planSpecs)).toBe(true);
  });

  it('returns false for non-matching sha', () => {
    const planSpecs: PlanSpecItem[] = [{
      date: '3/24', member: '哲緯',
      commit: { sha: 'abc12345', title: '', project: '', url: '', source: 'gitlab' },
      files: ['docs/spec.md'],
    }];
    expect(hasSpecFile('zzz99999', planSpecs)).toBe(false);
  });

  it('returns false for null planSpecs', () => {
    expect(hasSpecFile('abc12345', null)).toBe(false);
  });
});

// --- Integration test: badge renders in commit detail ---

const makeCommitData = (sha: string) => ({
  commits: {
    '3/24': {
      '哲緯': {
        count: 1,
        projects: ['bigdata/api'],
        items: [{ title: 'docs: API design', sha, project: 'bigdata/api', url: 'https://example.com', source: 'gitlab' as const }],
      },
    },
  },
  analysis: { '3/24': { '哲緯': { status: '✅', commitCount: 1, hours: 8 } } },
  projectRisks: [],
});

const defaultProps = {
  dates: ['3/24'],
  members: ['哲緯'],
  memberColors: { '哲緯': '#06b6d4' },
  leave: {},
  activeDate: '3/24',
  onDateSelect: vi.fn(),
  dailyDates: ['3/24'],
  dayLabels: { '3/24': '二' },
  taskAnalysisData: null,
};

describe('CommitsView spec badge integration', () => {
  it('renders 📋 badge when commit sha matches planSpecs', () => {
    const planSpecs: PlanSpecItem[] = [{
      date: '3/24', member: '哲緯',
      commit: { sha: 'abc12345', title: 'docs: API design', project: 'bigdata/api', url: '', source: 'gitlab' },
      files: ['docs/specs/api.md'],
    }];

    render(<CommitsView commitData={makeCommitData('abc12345')} {...defaultProps} planSpecs={planSpecs} />);
    fireEvent.click(screen.getByText(/1 commits/));
    expect(screen.getByText('📋')).toBeInTheDocument();
  });

  it('does not render 📋 badge when no planSpecs match', () => {
    const planSpecs: PlanSpecItem[] = [{
      date: '3/24', member: '哲緯',
      commit: { sha: 'zzz99999', title: 'other', project: 'other', url: '', source: 'gitlab' },
      files: ['docs/other.md'],
    }];

    render(<CommitsView commitData={makeCommitData('abc12345')} {...defaultProps} planSpecs={planSpecs} />);
    fireEvent.click(screen.getByText(/1 commits/));
    expect(screen.queryByText('📋')).toBeNull();
  });

  it('does not render 📋 badge when planSpecs is null', () => {
    render(<CommitsView commitData={makeCommitData('abc12345')} {...defaultProps} planSpecs={null} />);
    fireEvent.click(screen.getByText(/1 commits/));
    expect(screen.queryByText('📋')).toBeNull();
  });
});
