import { extractSignificantLines, checkReadmePlagiarism } from '../readme-checker';
import { Octokit } from '@octokit/rest';

jest.mock('@octokit/rest');

describe('readme-checker', () => {
  // --- extractSignificantLines tests ---

  it('should filter out short lines', () => {
    const input = [
      'Short line',
      'Also short',
      'This application uses machine learning to predict housing prices in real time',
    ].join('\n');

    const result = extractSignificantLines(input);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('machine learning');
  });

  it('should filter out boilerplate lines', () => {
    const input = [
      '## What we learned',
      '## How we built it',
      'npm install my-package',
      '## Getting Started',
    ].join('\n');

    const result = extractSignificantLines(input);
    expect(result).toHaveLength(0);
  });

  it('should keep significant descriptive lines', () => {
    const input = [
      'This application uses machine learning to predict housing prices in real time',
      'Our API connects to three external data sources and aggregates results into a unified dashboard',
    ].join('\n');

    const result = extractSignificantLines(input);
    expect(result).toHaveLength(2);
    expect(result[0]).toContain('machine learning');
    expect(result[1]).toContain('unified dashboard');
  });

  it('should strip markdown formatting before evaluating', () => {
    const input = '**This application uses machine learning to predict housing prices**';

    const result = extractSignificantLines(input);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('This application uses machine learning to predict housing prices');
  });

  // --- checkReadmePlagiarism tests ---

  let mockSearchCode: jest.Mock;
  let mockOctokit: { rest: { search: { code: jest.Mock } } };

  beforeEach(() => {
    mockSearchCode = jest.fn();
    mockOctokit = { rest: { search: { code: mockSearchCode } } };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should detect plagiarism when lines are found in other repos', async () => {
    mockSearchCode.mockResolvedValue({
      data: { items: [{ repository: { full_name: 'other-owner/other-repo' } }] }
    });

    const lines = [
      'This application uses machine learning to predict housing prices in real time',
      'Our API connects to three external data sources and aggregates results into a dashboard',
      'The system processes over ten thousand requests per second using async workers',
    ];
    const result = await checkReadmePlagiarism(mockOctokit as unknown as Octokit, 'owner', 'repo', lines, 2);

    expect(result.isPlagiarized).toBe(true);
    expect(result.matchedLines.length).toBeGreaterThanOrEqual(2);
  });

  it('should not flag when matches are only from the same repo', async () => {
    mockSearchCode.mockResolvedValue({
      data: { items: [{ repository: { full_name: 'owner/repo' } }] }
    });

    const lines = [
      'This application uses machine learning to predict housing prices in real time',
      'Our API connects to three external data sources and aggregates results into a dashboard',
    ];
    const result = await checkReadmePlagiarism(mockOctokit as unknown as Octokit, 'owner', 'repo', lines, 2);

    expect(result.isPlagiarized).toBe(false);
    expect(result.matchedLines).toHaveLength(0);
  });

  it('should early exit once matchThreshold is reached', async () => {
    mockSearchCode.mockResolvedValue({
      data: { items: [{ repository: { full_name: 'other-owner/other-repo' } }] }
    });

    const lines = [
      'Line one is significant and describes the project in detail for plagiarism',
      'Line two is significant and describes the project in detail for plagiarism',
      'Line three is significant and describes the project in detail for plagiarism',
      'Line four is significant and describes the project in detail for plagiarism',
      'Line five is significant and describes the project in detail for plagiarism',
    ];
    const result = await checkReadmePlagiarism(mockOctokit as unknown as Octokit, 'owner', 'repo', lines, 2);

    expect(result.isPlagiarized).toBe(true);
    expect(mockSearchCode).toHaveBeenCalledTimes(2);
  });

  it('should skip lines that cause search API errors', async () => {
    const error = Object.assign(new Error('Validation Failed'), { status: 422 });
    mockSearchCode
      .mockRejectedValueOnce(error)
      .mockResolvedValue({
        data: { items: [{ repository: { full_name: 'other-owner/other-repo' } }] }
      });

    const lines = [
      'This line causes a search error due to special characters in the query string',
      'This application uses machine learning to predict housing prices in real time',
      'Our API connects to three external data sources and aggregates results into a dashboard',
    ];
    const result = await checkReadmePlagiarism(mockOctokit as unknown as Octokit, 'owner', 'repo', lines, 2);

    expect(() => result).not.toThrow();
    expect(result.isPlagiarized).toBe(true);
    expect(result.matchedLines).toHaveLength(2);
  });
});
