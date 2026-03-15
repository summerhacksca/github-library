# @summerhacksca/github-library

A TypeScript library for hackathon organizers to validate participant GitHub repository submissions without cloning any code. Uses the GitHub REST API to check for rule violations including forks, out-of-window commits, team size limits, and README plagiarism detection.

## Installation

```bash
npm install @summerhacksca/github-library
```

## Quick Start

```typescript
import { validateRepo, ValidatorConfig } from '@summerhacksca/github-library';

const config: ValidatorConfig = {
  githubToken: process.env.GITHUB_TOKEN,
  timeWindow: {
    start: '2026-03-12T08:00:00Z',
    end: '2026-03-15T18:00:00Z',
  },
  maxTeamSize: 4,
};

const result = await validateRepo('https://github.com/participant/their-hack', config);

if (result.isValid) {
  console.log('Valid! Contributors:', result.humanContributors);
} else {
  console.log('Violations:', result.violations);
}
```

## Batch Validation

To validate multiple submissions at once, use `validateRepos()`. It runs sequentially to respect GitHub API rate limits.

```typescript
import { validateRepos, ValidatorConfig } from '@summerhacksca/github-library';

const config: ValidatorConfig = {
  githubToken: process.env.GITHUB_TOKEN,
  timeWindow: {
    start: '2026-03-12T08:00:00Z',
    end: '2026-03-15T18:00:00Z',
  },
  maxTeamSize: 4,
  readmePlagiarism: {
    enabled: true,
    matchThreshold: 3,
  },
};

const repos = [
  'https://github.com/team1/project',
  'https://github.com/team2/project',
  'https://github.com/team3/project',
];

const results = await validateRepos(repos, config);

for (const [url, result] of results) {
  if (result.isValid) {
    console.log(`${url}: PASSED (${result.humanContributors.join(', ')})`);
  } else {
    console.log(`${url}: FAILED`, result.violations);
  }
}
```

## Configuration Reference

`ValidatorConfig`

- `githubToken` (optional string) — GitHub personal access token. Not required for public repos but strongly recommended. Unauthenticated requests are limited to 60/hour for the REST API and 10/minute for the search API. Authenticated requests get 5,000/hour and 30/minute respectively.
- `timeWindow.start` (Date or ISO string) — Hackathon start time. Commits before this are a violation.
- `timeWindow.end` (Date or ISO string) — Hackathon deadline. Commits after this are a violation.
- `maxTeamSize` (number) — Maximum allowed human contributors. Includes co-authors from `Co-authored-by` commit trailers.
- `readmePlagiarism` (optional object) — Opt-in README plagiarism detection.
  - `enabled` (boolean) — Set to `true` to enable.
  - `matchThreshold` (number) — How many significant README lines found in other GitHub repos triggers a violation.

## Response Reference

`ValidationResult`

- `isValid` (boolean) — `true` when `violations` is empty.
- `humanContributors` (string array) — GitHub usernames of detected human contributors. Bot accounts are filtered out.
- `violations` (string array) — List of rule violations found. Empty means the repo passed.

## Possible Violations

- `"Invalid GitHub URL provided."`
- `"Repository is a fork"`
- `"Commits exist before hackathon start"`
- `"Commits exist after hackathon deadline"`
- `"Team size exceeded: found {n}, max is {maxTeamSize}"`
- `"README plagiarism detected: {n} significant lines found in other repositories"`
- `"Repository not found or is private."`
- `"GitHub API rate limit exceeded. Please provide a githubToken."`
- `"Failed to fetch repository data: {error message}"`

## Bot Filtering

The library automatically filters bot accounts from contributor counts using four detection layers: GitHub API account type, a hardcoded list of known bots (dependabot, github-actions, renovate, snyk-bot, etc.), regex patterns on usernames, and keyword matching for AI tools (claude, copilot, gpt).

## Rate Limits

The library uses `@octokit/plugin-throttling` to automatically retry on rate limit errors with up to 2 retries. Passing a `githubToken` is strongly recommended if you're validating multiple repos or using the README plagiarism feature, since code search has a tight rate limit of 10 requests/minute unauthenticated vs 30 authenticated.

## Co-authored Commits

The library parses `Co-authored-by` trailers in commit messages. Co-authors are included in `humanContributors` and count toward `maxTeamSize`. For GitHub noreply emails, the username is extracted automatically. Non-GitHub emails are used as-is.

## Limitations

- Git history can be rewritten (force push, rebase) to hide pre-hackathon work. This library is a first-pass filter, not a security tool.
- README plagiarism relies on GitHub code search which only indexes public repos and files under a certain size.
- Co-authors with non-GitHub emails appear as email addresses rather than usernames in `humanContributors`.
