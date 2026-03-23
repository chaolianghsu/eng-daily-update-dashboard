import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock("recharts", () => import("../__mocks__/recharts"));

import CommitsView from '../../src/CommitsView';

const makeCommitData = (source?: 'gitlab' | 'github') => ({
  commits: {
    '3/19': {
      'A': {
        count: 1,
        projects: ['repo-1'],
        items: [{ title: 'fix bug', sha: '1234abcd', project: 'repo-1', url: 'http://example.com', source }],
      },
    },
  },
  analysis: { '3/19': { 'A': { status: '✅', commitCount: 1, hours: 8 } } },
  projectRisks: [],
});

const defaultProps = {
  dates: ['3/19'],
  members: ['A'],
  memberColors: { A: '#ff0000' },
  leave: {},
  activeDate: '3/19',
  onDateSelect: () => {},
  dailyDates: ['3/19'],
  dayLabels: { '3/19': '三' },
  taskAnalysisData: null,
};

describe('CommitsView source icons', () => {
  it('renders GitLab icon (🦊) for source: "gitlab"', () => {
    render(<CommitsView commitData={makeCommitData('gitlab')} {...defaultProps} />);
    fireEvent.click(screen.getByText(/1 commits/));
    expect(screen.getByTitle('GitLab')).toBeDefined();
    expect(screen.getByText('🦊')).toBeDefined();
  });

  it('renders GitHub icon (🐙) for source: "github"', () => {
    render(<CommitsView commitData={makeCommitData('github')} {...defaultProps} />);
    fireEvent.click(screen.getByText(/1 commits/));
    expect(screen.getByTitle('GitHub')).toBeDefined();
    expect(screen.getByText('🐙')).toBeDefined();
  });

  it('defaults to GitLab icon when source is undefined', () => {
    render(<CommitsView commitData={makeCommitData(undefined)} {...defaultProps} />);
    fireEvent.click(screen.getByText(/1 commits/));
    expect(screen.getByTitle('GitLab')).toBeDefined();
    expect(screen.getByText('🦊')).toBeDefined();
  });
});
