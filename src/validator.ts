import { Octokit } from '@octokit/rest';
import { ValidatorConfig, ValidationResult } from './types';
import { filterBots, Contributor } from './bot-filter';

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

  const octokit = new Octokit({
    auth: config.githubToken,
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
    const allCommitsResponse = await octokit.rest.repos.listCommits({
      owner,
      repo,
      per_page: 100
    });

    const hasEarlyCommit = allCommitsResponse.data.some((commitItem) => {
      if (!commitItem.commit.author?.date) return false;
      return new Date(commitItem.commit.author.date) < hackathonStart;
    });

    if (hasEarlyCommit) {
      violations.push('Commits exist before hackathon start');
    }

    const hasLateCommit = allCommitsResponse.data.some((commitItem) => {
      if (!commitItem.commit.author?.date) return false;
      return new Date(commitItem.commit.author.date) > hackathonEnd;
    });

    if (hasLateCommit) {
      violations.push('Commits exist after hackathon deadline');
    }

    // 4. Fetch windowed commits to determine human contributors
    const commitsResponse = await octokit.rest.repos.listCommits({
      owner,
      repo,
      since: hackathonStart.toISOString(),
      until: hackathonEnd.toISOString(),
      per_page: 100
    });

    const committersMap = new Map<string, Contributor>();

    for (const commitItem of commitsResponse.data) {
      if (commitItem.author && commitItem.author.login) {
        committersMap.set(commitItem.author.login, {
          login: commitItem.author.login,
          type: commitItem.author.type
        });
      }
    }

    const uniqueContributors = Array.from(committersMap.values());
    const humans = filterBots(uniqueContributors);
    humanContributors.push(...humans.map(c => c.login));

    // 5. Team size check
    if (humanContributors.length > config.maxTeamSize) {
      violations.push(`Team size exceeded: found ${humanContributors.length}, max is ${config.maxTeamSize}`);
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
