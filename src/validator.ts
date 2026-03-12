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
  const result: ValidationResult = {
    isValid: true,
    humanContributors: [],
    validationErrors: [],
    cloneDetection: {
      isClone: false,
      suspicionScore: 0,
      reasons: []
    }
  };

  const parsed = parseGithubUrl(repoUrl);
  if (!parsed) {
    result.isValid = false;
    result.validationErrors.push('Invalid GitHub URL provided.');
    return result;
  }

  const { owner, repo } = parsed;

  const octokit = new Octokit({
    auth: config.githubToken,
  });

  try {
    // 1. Verify repo exists and is accessible
    const repoResponse = await octokit.rest.repos.get({ owner, repo });

    // 1b. Fast native Fork check
    if (repoResponse.data.fork) {
      result.cloneDetection.suspicionScore += 100;
      result.cloneDetection.reasons.push(
        `Repository is a fork of ${repoResponse.data.parent?.html_url || 'another project'}.`
      );
    }

    // 2. Fetch commits within the time window
    const since = new Date(config.timeWindow.start).toISOString();
    const until = new Date(config.timeWindow.end).toISOString();

    const commitsResponse = await octokit.rest.repos.listCommits({
      owner,
      repo,
      since,
      until,
      per_page: 100 // Depending on hackathon size, we might need pagination, but 100 defaults is ok for now without auto-pagination plugin
    });

    const committersMap = new Map<string, Contributor>();

    for (const commitItem of commitsResponse.data) {
      // Author could be null if it's not linked to a GitHub account
      if (commitItem.author && commitItem.author.login) {
        committersMap.set(commitItem.author.login, {
          login: commitItem.author.login,
          type: commitItem.author.type
        });
      }
    }

    const uniqueContributors = Array.from(committersMap.values());
    const humanContributors = filterBots(uniqueContributors);

    result.humanContributors = humanContributors.map(c => c.login);

    if (result.humanContributors.length > config.maxTeamSize) {
      result.isValid = false;
      result.validationErrors.push(`Team size exceeded. Expected max ${config.maxTeamSize}, but found ${result.humanContributors.length} human contributors.`);
    }

    // Final clone evaluation
    if (result.cloneDetection.suspicionScore >= 100) {
      result.cloneDetection.isClone = true;
    }

  } catch (error: any) {
    result.isValid = false;
    if (error.status === 404) {
      result.validationErrors.push('Repository not found or is private.');
    } else if (error.status === 403) {
      result.validationErrors.push('GitHub API rate limit exceeded. Please provide a githubToken.');
    } else {
      result.validationErrors.push(`Failed to fetch repository data: ${error.message}`);
    }
  }

  return result;
}
