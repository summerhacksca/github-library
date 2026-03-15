import { validateRepo } from '../validator';
import { ValidatorConfig } from '../types';
import { Octokit } from '@octokit/rest';
import { fetchReadme, extractSignificantLines, checkReadmePlagiarism } from '../readme-checker';

jest.mock('@octokit/rest');
jest.mock('../readme-checker', () => ({
  fetchReadme: jest.fn(),
  extractSignificantLines: jest.fn(),
  checkReadmePlagiarism: jest.fn(),
}));

const mockFetchReadme = fetchReadme as jest.Mock;
const mockExtractSignificantLines = extractSignificantLines as jest.Mock;
const mockCheckReadmePlagiarism = checkReadmePlagiarism as jest.Mock;

describe('validator', () => {
  let mockListCommits: jest.Mock;
  let mockGetRepo: jest.Mock;

  beforeEach(() => {
    mockListCommits = jest.fn();
    mockGetRepo = jest.fn();

    (Octokit as unknown as jest.Mock).mockImplementation(() => {
      return {
        rest: {
          repos: {
            get: mockGetRepo,
            listCommits: mockListCommits
          }
        }
      };
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return violation for invalid GitHub URL', async () => {
    const config: ValidatorConfig = { timeWindow: { start: new Date(), end: new Date() }, maxTeamSize: 4 };
    const result = await validateRepo('not-a-valid-url', config);
    expect(result.isValid).toBe(false);
    expect(result.violations.some(v => v.includes('Invalid GitHub URL'))).toBe(true);
  });

  it('should return violation when repo is a fork', async () => {
    mockGetRepo.mockResolvedValueOnce({ data: { fork: true } });
    mockListCommits.mockResolvedValueOnce({ data: [] }); // all commits
    mockListCommits.mockResolvedValueOnce({ data: [] }); // windowed commits

    const config: ValidatorConfig = { timeWindow: { start: '2026-03-12T08:00:00Z', end: '2026-03-15T18:00:00Z' }, maxTeamSize: 4 };
    const result = await validateRepo('https://github.com/owner/forked-repo', config);
    expect(result.isValid).toBe(false);
    expect(result.violations).toContain('Repository is a fork');
  });

  it('should return violation when commits exist before hackathon start', async () => {
    mockGetRepo.mockResolvedValueOnce({ data: { fork: false } });
    mockListCommits.mockResolvedValueOnce({
      data: [
        {
          commit: { author: { date: '2025-01-01T00:00:00Z' } },
          author: { login: 'early-dev', type: 'User' }
        }
      ]
    }); // all commits
    mockListCommits.mockResolvedValueOnce({ data: [] }); // windowed commits

    const config: ValidatorConfig = { timeWindow: { start: '2026-03-12T08:00:00Z', end: '2026-03-15T18:00:00Z' }, maxTeamSize: 4 };
    const result = await validateRepo('https://github.com/owner/repo', config);
    expect(result.violations).toContain('Commits exist before hackathon start');
  });

  it('should return violation when commits exist after hackathon deadline', async () => {
    mockGetRepo.mockResolvedValueOnce({ data: { fork: false } });
    mockListCommits.mockResolvedValueOnce({
      data: [
        {
          commit: { author: { date: '2027-01-01T00:00:00Z' } },
          author: { login: 'late-dev', type: 'User' }
        }
      ]
    }); // all commits
    mockListCommits.mockResolvedValueOnce({ data: [] }); // windowed commits

    const config: ValidatorConfig = { timeWindow: { start: '2026-03-12T08:00:00Z', end: '2026-03-15T18:00:00Z' }, maxTeamSize: 4 };
    const result = await validateRepo('https://github.com/owner/repo', config);
    expect(result.violations).toContain('Commits exist after hackathon deadline');
  });

  it('should return only human contributors and pass when within team size', async () => {
    mockGetRepo.mockResolvedValueOnce({ data: { fork: false } });

    const commits = [
      { commit: { author: { date: '2026-03-13T10:00:00Z' } }, author: { login: 'human-dev', type: 'User' } },
      { commit: { author: { date: '2026-03-13T11:00:00Z' } }, author: { login: 'dependabot[bot]', type: 'Bot' } }
    ];
    mockListCommits.mockResolvedValueOnce({ data: commits }); // all commits
    mockListCommits.mockResolvedValueOnce({ data: commits }); // windowed commits

    const config: ValidatorConfig = { timeWindow: { start: '2026-03-12T08:00:00Z', end: '2026-03-15T18:00:00Z' }, maxTeamSize: 4 };
    const result = await validateRepo('https://github.com/owner/repo', config);
    expect(result.isValid).toBe(true);
    expect(result.humanContributors).toEqual(['human-dev']);
    expect(result.violations).toHaveLength(0);
  });

  it('should return violation when team size is exceeded', async () => {
    mockGetRepo.mockResolvedValueOnce({ data: { fork: false } });

    const commits = [
      { commit: { author: { date: '2026-03-13T10:00:00Z' } }, author: { login: 'dev-one', type: 'User' } },
      { commit: { author: { date: '2026-03-13T11:00:00Z' } }, author: { login: 'dev-two', type: 'User' } }
    ];
    mockListCommits.mockResolvedValueOnce({ data: commits }); // all commits
    mockListCommits.mockResolvedValueOnce({ data: commits }); // windowed commits

    const config: ValidatorConfig = { timeWindow: { start: '2026-03-12T08:00:00Z', end: '2026-03-15T18:00:00Z' }, maxTeamSize: 1 };
    const result = await validateRepo('https://github.com/owner/repo', config);
    expect(result.isValid).toBe(false);
    expect(result.violations.some(v => v.includes('Team size exceeded'))).toBe(true);
  });

  it('should not run plagiarism check when not enabled', async () => {
    mockGetRepo.mockResolvedValueOnce({ data: { fork: false } });
    const commits = [
      { commit: { author: { date: '2026-03-13T10:00:00Z' } }, author: { login: 'human-dev', type: 'User' } }
    ];
    mockListCommits.mockResolvedValueOnce({ data: commits });
    mockListCommits.mockResolvedValueOnce({ data: commits });

    const config: ValidatorConfig = { timeWindow: { start: '2026-03-12T08:00:00Z', end: '2026-03-15T18:00:00Z' }, maxTeamSize: 4 };
    const result = await validateRepo('https://github.com/owner/repo', config);

    expect(result.isValid).toBe(true);
    expect(mockFetchReadme).not.toHaveBeenCalled();
    expect(mockExtractSignificantLines).not.toHaveBeenCalled();
    expect(mockCheckReadmePlagiarism).not.toHaveBeenCalled();
  });

  it('should return violation when README plagiarism is detected', async () => {
    mockGetRepo.mockResolvedValueOnce({ data: { fork: false } });
    const commits = [
      { commit: { author: { date: '2026-03-13T10:00:00Z' } }, author: { login: 'human-dev', type: 'User' } }
    ];
    mockListCommits.mockResolvedValueOnce({ data: commits });
    mockListCommits.mockResolvedValueOnce({ data: commits });

    mockFetchReadme.mockResolvedValueOnce('Some README content');
    mockExtractSignificantLines.mockReturnValueOnce(['line1', 'line2', 'line3']);
    mockCheckReadmePlagiarism.mockResolvedValueOnce({ isPlagiarized: true, matchedLines: ['line1', 'line2'] });

    const config: ValidatorConfig = {
      timeWindow: { start: '2026-03-12T08:00:00Z', end: '2026-03-15T18:00:00Z' },
      maxTeamSize: 4,
      readmePlagiarism: { enabled: true, matchThreshold: 2 }
    };
    const result = await validateRepo('https://github.com/owner/repo', config);

    expect(result.isValid).toBe(false);
    expect(result.violations.some(v => v.includes('README plagiarism detected'))).toBe(true);
  });

  it('should pass when README plagiarism check finds no matches', async () => {
    mockGetRepo.mockResolvedValueOnce({ data: { fork: false } });
    const commits = [
      { commit: { author: { date: '2026-03-13T10:00:00Z' } }, author: { login: 'human-dev', type: 'User' } }
    ];
    mockListCommits.mockResolvedValueOnce({ data: commits });
    mockListCommits.mockResolvedValueOnce({ data: commits });

    mockFetchReadme.mockResolvedValueOnce('Some README content');
    mockExtractSignificantLines.mockReturnValueOnce(['line1', 'line2', 'line3']);
    mockCheckReadmePlagiarism.mockResolvedValueOnce({ isPlagiarized: false, matchedLines: [] });

    const config: ValidatorConfig = {
      timeWindow: { start: '2026-03-12T08:00:00Z', end: '2026-03-15T18:00:00Z' },
      maxTeamSize: 4,
      readmePlagiarism: { enabled: true, matchThreshold: 2 }
    };
    const result = await validateRepo('https://github.com/owner/repo', config);

    expect(result.isValid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });
});
