export interface ValidatorConfig {
  githubToken?: string;
  timeWindow: {
    start: Date | string;
    end: Date | string;
  };
  maxTeamSize: number;
}

export interface ValidationResult {
  isValid: boolean;
  humanContributors: string[];
  violations: string[];
}
