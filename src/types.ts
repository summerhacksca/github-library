export interface ValidatorConfig {
  githubToken?: string;
  timeWindow: {
    start: Date | string;
    end: Date | string;
  };
  maxTeamSize: number;
  readmePlagiarism?: {
    enabled: boolean;
    matchThreshold: number; // how many significant lines found elsewhere = violation
  };
}

export interface ValidationResult {
  isValid: boolean;
  humanContributors: string[];
  violations: string[];
}
