import type { AnalysisConfidence, FeatureContribution, SlopScore } from './types'

export interface ScoringFeatures {
  configSignal: number
  commitLanguageSignal: number
  commitBurstSignal: number
  commentPatternSignal: number
  repetitionSignal: number
  structureUniformitySignal: number
  evidenceSignals: number
  signalValues?: number[]
  indicatorCount?: number
  mediumHighIndicatorCount?: number
}

export function calculateSlopScore(features: ScoringFeatures): SlopScore {
  const weights = {
    configSignal: 0.16,
    commitLanguageSignal: 0.29,
    commitBurstSignal: 0.12,
    commentPatternSignal: 0.18,
    repetitionSignal: 0.15,
    structureUniformitySignal: 0.1,
  }

  const buildContribution = (
    feature: keyof typeof weights,
    raw: number,
    notes: string
  ): FeatureContribution => {
    const normalized = clamp(raw, 0, 1)
    const weight = weights[feature]
    return {
      feature,
      raw: round(raw),
      normalized: round(normalized),
      weight: round(weight),
      contribution: round(normalized * weight * 100),
      notes,
    }
  }

  const contributions: FeatureContribution[] = [
    buildContribution('configSignal', features.configSignal, 'AI-specific config and instruction files'),
    buildContribution('commitLanguageSignal', features.commitLanguageSignal, 'Commit language and narrative structure typical of AI-assisted workflows'),
    buildContribution('commitBurstSignal', features.commitBurstSignal, 'Bursty commit cadence and bulk-change messaging'),
    buildContribution('commentPatternSignal', features.commentPatternSignal, 'Prompt-like comments and AI boilerplate phrasing'),
    buildContribution('repetitionSignal', features.repetitionSignal, 'Similarity across sampled code files'),
    buildContribution('structureUniformitySignal', features.structureUniformitySignal, 'Uniform scaffold/module shape patterns'),
  ]

  const rawScore = contributions.reduce((sum, item) => sum + item.contribution, 0)
  const evidenceStrength = deriveEvidenceStrength(features.evidenceSignals, features.signalValues ?? [])
  const confidence = scoreConfidence(rawScore, evidenceStrength)
  const strongSignals = (features.signalValues ?? []).filter((value) => value >= 0.25).length
  const mediumHighIndicators = features.mediumHighIndicatorCount ?? 0
  const indicatorCount = features.indicatorCount ?? 0

  let adjustedScore = rawScore
  if (rawScore < 25 && strongSignals >= 2) {
    adjustedScore = rawScore + 12
  }
  if (rawScore < 35 && features.commentPatternSignal >= 0.2 && features.commitBurstSignal >= 0.35) {
    adjustedScore = Math.max(adjustedScore, 30)
  }
  if (features.commitLanguageSignal >= 0.5 && features.commitBurstSignal >= 0.35 && rawScore < 45) {
    adjustedScore = Math.max(adjustedScore, 42)
  }
  if (
    features.commitBurstSignal >= 0.45 &&
    features.commentPatternSignal >= 0.14 &&
    mediumHighIndicators >= 3
  ) {
    adjustedScore = Math.max(adjustedScore, 62)
  }
  if (features.commitLanguageSignal >= 0.35 && mediumHighIndicators >= 2 && indicatorCount >= 4) {
    adjustedScore = Math.max(adjustedScore, 56)
  }
  if (features.commitLanguageSignal >= 0.5 && features.commitBurstSignal >= 0.35 && mediumHighIndicators >= 3) {
    adjustedScore = Math.max(adjustedScore, 62)
  }
  if (mediumHighIndicators >= 4 && evidenceStrength >= 0.45) {
    adjustedScore = Math.max(adjustedScore, 68)
  }
  if (mediumHighIndicators >= 5 && evidenceStrength >= 0.5) {
    adjustedScore = Math.max(adjustedScore, 75)
  }
  if (evidenceStrength < 0.2) {
    adjustedScore = Math.min(adjustedScore, 40)
  }

  return {
    overall: clamp(Math.round(adjustedScore), 0, 100),
    breakdown: {
      configs: sumContributions(contributions, ['configSignal']),
      commits: sumContributions(contributions, ['commitLanguageSignal', 'commitBurstSignal']),
      patterns: sumContributions(contributions, ['commentPatternSignal']),
      structure: sumContributions(contributions, ['structureUniformitySignal']),
      repetition: sumContributions(contributions, ['repetitionSignal']),
    },
    confidence,
    evidenceStrength: round(evidenceStrength),
    contributions,
  }
}

function sumContributions(
  contributions: FeatureContribution[],
  featureNames: string[]
): number {
  return Math.round(
    contributions
      .filter((item) => featureNames.includes(item.feature))
      .reduce((sum, item) => sum + item.contribution, 0)
  )
}

function scoreConfidence(score: number, evidenceStrength: number): AnalysisConfidence {
  if (evidenceStrength < 0.22 || score < 12) return 'low'
  if (evidenceStrength < 0.7 || score < 45) return 'medium'
  return 'high'
}

function deriveEvidenceStrength(evidenceSignals: number, signalValues: number[]): number {
  const countStrength = clamp(evidenceSignals / 6, 0, 1)
  if (signalValues.length === 0) return countStrength

  const sorted = signalValues.slice().sort((a, b) => b - a)
  const top = sorted.slice(0, 3)
  const avgTop = average(top)
  const maxSignal = sorted[0] ?? 0
  return clamp(Math.max(countStrength, avgTop * 1.1, maxSignal * 0.45), 0, 1)
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min
  if (value > max) return max
  return value
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

export function getLikelihoodLabel(score: number): 'low' | 'moderate' | 'high' {
  if (score <= 20) return 'low'
  if (score <= 60) return 'moderate'
  return 'high'
}

export function getLikelihoodTone(score: number): 'safe' | 'warning' | 'danger' {
  if (score <= 20) return 'safe'
  if (score <= 60) return 'warning'
  return 'danger'
}

export function getSlopLevel(score: number): 'clean' | 'suspicious' | 'slop' {
  if (score <= 20) return 'clean'
  if (score <= 60) return 'suspicious'
  return 'slop'
}

export function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0
  return numerator / denominator
}

export function boundedScale(value: number, min: number, max: number): number {
  if (max <= min) return 0
  return clamp((value - min) / (max - min), 0, 1)
}

export function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function stddev(values: number[]): number {
  if (values.length < 2) return 0
  const avg = average(values)
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

export function similarityCoefficient(a: Set<string>, b: Set<string>): number {
  const union = new Set([...a, ...b])
  if (union.size === 0) return 0
  let intersection = 0
  for (const token of a) {
    if (b.has(token)) intersection++
  }
  return intersection / union.size
}
