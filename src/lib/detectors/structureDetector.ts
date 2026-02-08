import type { FileNode, SlopIndicator } from '../types'
import { boundedScale, ratio } from '../scoring'

export function detectBoilerplateStructure(files: FileNode[]): {
  uniformitySignal: number
  repeatedShapes: number
  indicators: SlopIndicator[]
} {
  const indicators: SlopIndicator[] = []
  const groups = new Map<string, string[]>()

  for (const file of files) {
    if (file.type !== 'file') continue
    const parts = file.path.split('/')
    const parent = parts.slice(0, -1).join('/')
    const leaf = parts[parts.length - 1]
    const list = groups.get(parent) ?? []
    list.push(leaf)
    groups.set(parent, list)
  }

  const shapeCounts = new Map<string, number>()
  for (const fileNames of groups.values()) {
    const shape = fileNames.slice().sort().join('|')
    if (shape.length === 0) continue
    shapeCounts.set(shape, (shapeCounts.get(shape) ?? 0) + 1)
  }

  let repeatedShapes = 0
  let directoriesWithRepeatedShape = 0
  for (const [shape, count] of shapeCounts.entries()) {
    if (count >= 3 && shape.split('|').length >= 2) {
      repeatedShapes++
      directoriesWithRepeatedShape += count
    }
  }

  const repeatedRatio = ratio(directoriesWithRepeatedShape, Math.max(groups.size, 1))
  const uniformitySignal = boundedScale((repeatedRatio * 1.2) + boundedScale(repeatedShapes, 1, 6), 0.15, 1.6)

  if (repeatedShapes > 0) {
    indicators.push({
      type: 'Uniform Module Scaffolds',
      description: `${repeatedShapes} repeating directory scaffold shapes detected`,
      severity: repeatedShapes >= 3 ? 'high' : 'medium',
    })
  }

  const repeatedNameRatio = detectRepeatedFileNames(files)
  if (repeatedNameRatio > 0.55) {
    indicators.push({
      type: 'Repeated File Templates',
      description: 'High ratio of repeated filenames across directories',
      severity: repeatedNameRatio > 0.72 ? 'high' : 'medium',
    })
  }

  return {
    uniformitySignal: Math.min(uniformitySignal + (repeatedNameRatio * 0.25), 1),
    repeatedShapes,
    indicators,
  }
}

function detectRepeatedFileNames(files: FileNode[]): number {
  const fileNameCounts = new Map<string, number>()
  let fileCount = 0

  for (const file of files) {
    if (file.type !== 'file') continue
    fileCount++
    fileNameCounts.set(file.name, (fileNameCounts.get(file.name) ?? 0) + 1)
  }

  if (fileCount === 0) return 0

  let repeated = 0
  for (const count of fileNameCounts.values()) {
    if (count > 1) {
      repeated += count
    }
  }

  return repeated / fileCount
}
