import { Octokit } from '@octokit/rest';
import { throttling } from '@octokit/plugin-throttling';
import { ValidatorConfig, ValidationResult } from './types';
import { filterBots, Contributor } from './bot-filter';
import { fetchReadme, extractSignificantLines, checkReadmePlagiarism } from './readme-checker';
import { parseCoAuthors } from './co-author-parser';


function parseGithubUrl(url: string): { owner: string; repo: string } | null {
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.hostname !== 'github.com') return null;

    const parts = parsedUrl.pathname.split('/').filter(Boolean);
    if (parts.length >= 2) {
      return { owner: parts[0], repo: parts[1] };
    }
    return null;
  } catch {
    return null;
  }
}

export async function validateRepo(repoUrl: string, config: ValidatorConfig): Promise<ValidationResult> {
  const violations: string[] = [];
  const humanContributors: string[] = [];

  const parsed = parseGithubUrl(repoUrl);
  if (!parsed) {
    violations.push('Invalid GitHub URL provided.');
    return { isValid: false, humanContributors, violations };
  }

  const { owner, repo } = parsed;

  const ThrottledOctokit = (Octokit as any).plugin?.(throttling as any) ?? Octokit;
  const octokit = new ThrottledOctokit({
    auth: config.githubToken,
    throttle: {
      onRateLimit: (retryAfter: number, options: any, octokit: any, retryCount: number) => {
        if (retryCount < 2) {
          return true;
        }
        return false;
      },
      onSecondaryRateLimit: (retryAfter: number, options: any, octokit: any, retryCount: number) => {
        if (retryCount < 2) {
          return true;
        }
        return false;
      },
    },
  });

  try {
    // 1. Verify repo exists and is accessible
    const repoResponse = await octokit.rest.repos.get({ owner, repo });

    // 2. Fork check
    if (repoResponse.data.fork) {
      violations.push('Repository is a fork');
    }

    const hackathonStart = new Date(config.timeWindow.start);
    const hackathonEnd = new Date(config.timeWindow.end);

    // 3. Fetch all commits to check for out-of-window commits
    const allCommits = await octokit.paginate(octokit.rest.repos.listCommits, {
      owner,
      repo,
      per_page: 100
    });

    const hasEarlyCommit = allCommits.some((commitItem: any) => {
      if (!commitItem.commit.author?.date) return false;
      return new Date(commitItem.commit.author.date) < hackathonStart;
    });

    if (hasEarlyCommit) {
      violations.push('Commits exist before hackathon start');
    }

    const hasLateCommit = allCommits.some((commitItem: any) => {
      if (!commitItem.commit.author?.date) return false;
      return new Date(commitItem.commit.author.date) > hackathonEnd;
    });

    if (hasLateCommit) {
      violations.push('Commits exist after hackathon deadline');
    }

    // 4. Fetch windowed commits to determine human contributors
    const windowedCommits = await octokit.paginate(octokit.rest.repos.listCommits, {
      owner,
      repo,
      since: hackathonStart.toISOString(),
      until: hackathonEnd.toISOString(),
      per_page: 100
    });

    const committersMap = new Map<string, Contributor>();

    for (const commitItem of windowedCommits) {
      if (commitItem.author && commitItem.author.login) {
        committersMap.set(commitItem.author.login, {
          login: commitItem.author.login,
          type: commitItem.author.type
        });
      }
      for (const identifier of parseCoAuthors(commitItem.commit.message ?? '')) {
        if (!committersMap.has(identifier)) {
          committersMap.set(identifier, { login: identifier, type: 'User' });
        }
      }
    }

    const uniqueContributors = Array.from(committersMap.values());
    const humans = filterBots(uniqueContributors);
    humanContributors.push(...humans.map(c => c.login));

    // 5. Team size check
    if (humanContributors.length > config.maxTeamSize) {
      violations.push(`Team size exceeded: found ${humanContributors.length}, max is ${config.maxTeamSize}`);
    }

    // 6. README plagiarism check (opt-in)
    if (config.readmePlagiarism?.enabled) {
      const readmeContent = await fetchReadme(octokit, owner, repo);
      if (readmeContent) {
        const significantLines = extractSignificantLines(readmeContent);
        if (significantLines.length > 0) {
          const { isPlagiarized, matchedLines } = await checkReadmePlagiarism(
            octokit, owner, repo, significantLines, config.readmePlagiarism.matchThreshold
          );
          if (isPlagiarized) {
            violations.push(`README plagiarism detected: ${matchedLines.length} significant lines found in other repositories`);
          }
        }
      }
    }

  } catch (error: any) {
    if (error.status === 404) {
      violations.push('Repository not found or is private.');
    } else if (error.status === 403) {
      violations.push('GitHub API rate limit exceeded. Please provide a githubToken.');
    } else {
      violations.push(`Failed to fetch repository data: ${error.message}`);
    }
  }

  return { isValid: violations.length === 0, humanContributors, violations };
}

export async function validateRepos(
  repoUrls: string[],
  config: ValidatorConfig
): Promise<Map<string, ValidationResult>> {
  const results = new Map<string, ValidationResult>();
  for (const url of repoUrls) {
    results.set(url, await validateRepo(url, config));
  }
  return results;
}
