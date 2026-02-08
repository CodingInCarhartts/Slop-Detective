import type { FileNode, SlopIndicatorSeverity } from '../types'

const CONFIG_FILES = [
  '.cursorrules',
  '.copilot-instructions',
  'copilot.yml',
  '.windsurfrules',
  '.ai-instructions',
  'ai-instructions.md',
  '.github/copilot-instructions.md',
  '.github/instructions.md',
  'CLAUDE.md',
  '.cursor/rules',
  '.continue/config.json',
]

export function detectConfigFiles(files: FileNode[]): {
  found: boolean
  files: string[]
  severity: SlopIndicatorSeverity
} {
  const foundFiles = files.filter(f => 
    CONFIG_FILES.some(config => f.name === config || f.path.endsWith(config))
  )

  const severity: SlopIndicatorSeverity = foundFiles.length > 1 ? 'high' : foundFiles.length === 1 ? 'medium' : 'low'

  return {
    found: foundFiles.length > 0,
    files: foundFiles.map(f => f.path),
    severity,
  }
}
