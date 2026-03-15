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
  'make sure you have',
  'you will need',
  'clone this repository',
  'run the following',
  'open your browser',
  'navigate to',
  'create a new file',
  'set up your',
  'make sure to',
  "don't forget to",
  'feel free to',
  'we decided to use',
  'this project uses',
  'we used',
  'powered by',
  'fork this repo',
  'pull request',
  'open an issue',
  'contributions are welcome',
];

const TECH_WORDS = new Set([
  'react', 'node', 'express', 'mongodb', 'python', 'flask', 'django',
  'typescript', 'javascript', 'html', 'css', 'tailwind', 'next', 'vue',
  'angular', 'postgres', 'mysql', 'redis', 'docker', 'aws', 'firebase',
  'supabase', 'vercel', 'heroku',
]);

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
      if (line.length < 50) return false;

      const words = line.split(/\s+/).filter(Boolean);
      if (words.length < 8) return false;

      const lower = line.toLowerCase();
      if (BOILERPLATE_PATTERNS.some(pattern => lower.includes(pattern))) return false;

      // Filter lines that are mostly URLs
      const urlMatch = lower.match(/https?:\/\/\S+/);
      if (urlMatch && urlMatch[0].length > line.length / 2) return false;

      // Filter tech stack list lines
      const techWordCount = words.filter(w => TECH_WORDS.has(w.toLowerCase())).length;
      if (techWordCount > words.length / 2) return false;

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

function fisherYatesShuffle<T>(arr: T[]): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export async function checkReadmePlagiarism(
  octokit: Octokit,
  owner: string,
  repo: string,
  significantLines: string[],
  matchThreshold: number
): Promise<{ isPlagiarized: boolean; matchedLines: string[] }> {
  const matchedLines: string[] = [];
  const ownFullName = `${owner}/${repo}`;

  const linesToSearch = significantLines.length > 10
    ? fisherYatesShuffle(significantLines).slice(0, 10)
    : significantLines;

  for (const line of linesToSearch) {
    if (matchedLines.length >= matchThreshold) break;

    try {
      const response = await octokit.rest.search.code({ q: line });
      const externalMatch = response.data.items.some(
        item => item.repository.full_name !== ownFullName
      );
      if (externalMatch) {
        matchedLines.push(line);
      }
    } catch {
      // skip lines that cause search errors (403, 422, etc.)
    }
  }

  return { isPlagiarized: matchedLines.length >= matchThreshold, matchedLines };
}
