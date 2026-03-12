export interface ValidatorConfig {
  githubToken?: string;
  timeWindow: {
    start: Date | string;
    end: Date | string;
  };
  maxTeamSize: number;
}

export interface CloneDetectionResult {
  isClone: boolean;
  suspicionScore: number;
  reasons: string[];
}

export interface ValidationResult {
  isValid: boolean;
  humanContributors: string[]; // List of github usernames
  validationErrors: string[];
  cloneDetection: CloneDetectionResult;
}
