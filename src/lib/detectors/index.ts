import { detectConfigFiles } from './configDetector'
import { analyzeCommitMessages } from './commitAnalyzer'
import { detectVerboseComments } from './commentDetector'
import { detectBoilerplateStructure } from './structureDetector'
import { detectCodePatterns } from './codePatternDetector'
import { detectRepetition } from './repetitionDetector'

export {
  detectConfigFiles,
  analyzeCommitMessages,
  detectVerboseComments,
  detectBoilerplateStructure,
  detectCodePatterns,
  detectRepetition,
}
