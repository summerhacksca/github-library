import { extractSignificantLines } from '../readme-checker';

describe('readme-checker', () => {
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
});
