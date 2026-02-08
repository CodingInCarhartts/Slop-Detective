import type { SlopIndicator } from '../types'
import { average, boundedScale, similarityCoefficient } from '../scoring'

export function detectRepetition(samples: Array<{ path: string; content: string }>): {
  repetitionSignal: number
  averageSimilarity: number
  indicators: SlopIndicator[]
} {
  if (samples.length < 2) {
    return {
      repetitionSignal: 0,
      averageSimilarity: 0,
      indicators: [],
    }
  }

  const tokenSets = samples.map((sample) => tokenSet(normalizeContent(sample.content)))
  const similarities: number[] = []

  for (let i = 0; i < tokenSets.length; i++) {
    for (let j = i + 1; j < tokenSets.length; j++) {
      similarities.push(similarityCoefficient(tokenSets[i], tokenSets[j]))
    }
  }

  const avgSimilarity = average(similarities)
  const repetitionSignal = boundedScale(avgSimilarity, 0.16, 0.5)
  const indicators: SlopIndicator[] = []

  if (avgSimilarity >= 0.24) {
    indicators.push({
      type: 'High Cross-file Similarity',
      description: `Average sampled similarity ${Math.round(avgSimilarity * 100)}%`,
      severity: avgSimilarity >= 0.36 ? 'high' : 'medium',
    })
  }

  return {
    repetitionSignal,
    averageSimilarity: avgSimilarity,
    indicators,
  }
}

function normalizeContent(content: string): string {
  return content
    .replace(/(["'`])(?:\\.|(?!\1).)*\1/g, 'STR')
    .replace(/\b\d+\b/g, 'NUM')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function tokenSet(content: string): Set<string> {
  const tokens = content.split(' ').filter((token) => token.length > 2)
  const limited = tokens.slice(0, 500)
  return new Set(limited)
}
