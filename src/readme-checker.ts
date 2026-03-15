import { Octokit } from '@octokit/rest';

const BOILERPLATE_PATTERNS = [
  'what we learned', 'what i learned',
  'how we built', 'how i built',
  'challenges we ran into', 'challenges i ran into',
  'accomplishments',
  "what's next",
  'getting started',
  'prerequisites',
  'installation',
  'how to install',
  'how to run',
  'built with',
  'tech stack',
  'technologies used',
  'table of contents',
  'contributing',
  'license',
  'acknowledgments',
  'acknowledgements',
  'authors',
  'inspiration',
  'npm install',
  'npm start',
  'npm run',
  'git clone',
  'yarn add',
  'pip install',
];

export function extractSignificantLines(readmeContent: string): string[] {
  return readmeContent
    .split('\n')
    .map(line =>
      line
        .replace(/^#+\s*/, '')
        .replace(/[*_`[\]()]/g, '')
        .trim()
    )
    .filter(line => {
      if (line.length === 0) return false;
      if (line.length < 30) return false;
      const lower = line.toLowerCase();
      if (BOILERPLATE_PATTERNS.some(pattern => lower.includes(pattern))) return false;
      return true;
    });
}

export async function fetchReadme(octokit: Octokit, owner: string, repo: string): Promise<string | null> {
  try {
    const response = await octokit.rest.repos.getReadme({ owner, repo });
    return Buffer.from(response.data.content, 'base64').toString('utf-8');
  } catch {
    return null;
  }
}
