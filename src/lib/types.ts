export interface RepoAnalysis {
  repoId: string
  repoName: string
  slopScore: number
  confidence: AnalysisConfidence
  stage: AnalysisStage
  semantics: 'likelihood'
  indicators: SlopIndicator[]
  scoreBreakdown: ScoreBreakdown
  diagnostics: AnalysisDiagnostics
  cache: {
    isCached: boolean
    cacheKey?: string
  }
  timestamp: number
}

export type AnalysisStage = 'provisional' | 'final'
export type AnalysisConfidence = 'low' | 'medium' | 'high'

export type SlopIndicatorSeverity = 'low' | 'medium' | 'high'

export interface SlopIndicator {
  type: string
  description: string
  severity: SlopIndicatorSeverity
}

export interface SlopScore {
  overall: number
  breakdown: ScoreBreakdown
  confidence: AnalysisConfidence
  evidenceStrength: number
  contributions: FeatureContribution[]
}

export interface ScoreBreakdown {
  configs: number
  commits: number
  patterns: number
  structure: number
  repetition: number
}

export interface FeatureContribution {
  feature: string
  raw: number
  normalized: number
  weight: number
  contribution: number
  notes: string
}

export interface AnalysisDiagnostics {
  timingMs: {
    startedAt: number
    timeToFirstBadge: number
    timeToFinalScore?: number
  }
  requestCount: number
  sampledFiles: number
  featureValues: Record<string, number>
  scoreContributions: FeatureContribution[]
  evidenceStrength: number
}

export interface FileNode {
  name: string
  path: string
  type: 'file' | 'dir'
  url?: string
}

export interface Settings {
  githubToken?: string
  autoAnalyze: boolean
  darkMode: boolean
}

export interface GitHubCommit {
  sha: string
  commit: {
    message: string
    author: {
      date: string
    }
  }
  files?: GitHubFile[]
}

export interface GitHubFile {
  filename: string
  additions: number
  deletions: number
  status: string
}

export interface GitHubTreeItem {
  path: string
  type: string
  url: string
}

export interface GitHubRepo {
  default_branch: string
  name: string
  full_name: string
  created_at?: string
  stargazers_count?: number
}

export interface RepoContext {
  owner: string
  repo: string
  defaultBranch: string
}
