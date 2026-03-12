import { validateRepo } from '../validator';
import { ValidatorConfig } from '../types';
import { Octokit } from '@octokit/rest';

// We mock octokit so we don't hit the real API in tests
jest.mock('@octokit/rest');

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

  it('should invalidate incorrect github urls', async () => {
    const config: ValidatorConfig = { timeWindow: { start: new Date(), end: new Date() }, maxTeamSize: 4 };
    const result = await validateRepo('https://example.com', config);
    expect(result.isValid).toBe(false);
    expect(result.validationErrors).toContain('Invalid GitHub URL provided.');
  });

  it('should flag a repository if it is a direct fork', async () => {
    mockGetRepo.mockResolvedValueOnce({
      data: {
        fork: true,
        parent: { html_url: 'https://github.com/original/repo' }
      }
    });

    // Mock commits resolving empty
    mockListCommits.mockResolvedValueOnce({ data: [] });

    const config: ValidatorConfig = { timeWindow: { start: new Date(), end: new Date() }, maxTeamSize: 4 };
    const result = await validateRepo('https://github.com/owner/forked-repo', config);
    
    expect(result.cloneDetection.isClone).toBe(true);
    expect(result.cloneDetection.suspicionScore).toBeGreaterThanOrEqual(100);
    expect(result.cloneDetection.reasons[0]).toContain('https://github.com/original/repo');
  });

  it('should correctly identify human contributors and respect team size', async () => {
    mockGetRepo.mockResolvedValueOnce({ data: {} });
    mockListCommits.mockResolvedValueOnce({
      data: [
        { author: { login: 'human-coder', type: 'User' } },
        { author: { login: 'dependabot[bot]', type: 'Bot' } },
        { author: { login: 'another-human', type: 'User' } },
        { author: { login: 'human-coder', type: 'User' } }, // Duplicate commit
      ]
    });

    const config: ValidatorConfig = {
      timeWindow: {
        start: '2026-03-01T00:00:00Z',
        end: '2026-03-15T00:00:00Z'
      },
      maxTeamSize: 4
    };

    const result = await validateRepo('https://github.com/my-org/hackathon-repo', config);

    expect(result.humanContributors).toEqual(['human-coder', 'another-human']);
    expect(result.isValid).toBe(true);
    expect(result.validationErrors).toHaveLength(0);
  });

  it('should invalidate if team size exceeds maxTeamSize', async () => {
    mockGetRepo.mockResolvedValueOnce({ data: {} });
    mockListCommits.mockResolvedValueOnce({
      data: [
        { author: { login: 'human1', type: 'User' } },
        { author: { login: 'human2', type: 'User' } },
        { author: { login: 'human3', type: 'User' } },
        { author: { login: 'human4', type: 'User' } },
        { author: { login: 'human5', type: 'User' } },
      ]
    });

    const config: ValidatorConfig = {
      timeWindow: { start: '2026-03-01T00:00:00Z', end: '2026-03-15T00:00:00Z' },
      maxTeamSize: 4
    };

    const result = await validateRepo('https://github.com/my-org/hackathon-repo', config);

    expect(result.humanContributors).toHaveLength(5);
    expect(result.isValid).toBe(false);
    expect(result.validationErrors[0]).toMatch(/Team size exceeded/);
  });
});
