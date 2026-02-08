import { fetchCommitHistory, fetchFileContent, fetchRepoInfo, fetchRepoTree, GitHubApiError } from '../lib/github'
import { getCachedAnalysisByKey, cacheAnalysisByKey, getToken } from '../lib/storage'
import { detectConfigFiles } from '../lib/detectors/configDetector'
import { analyzeCommitMessages } from '../lib/detectors/commitAnalyzer'
import { detectVerboseComments } from '../lib/detectors/commentDetector'
import { detectBoilerplateStructure } from '../lib/detectors/structureDetector'
import { detectCodePatterns } from '../lib/detectors/codePatternDetector'
import { detectRepetition } from '../lib/detectors/repetitionDetector'
import { boundedScale, calculateSlopScore } from '../lib/scoring'
import type { RepoAnalysis, SlopIndicator, FileNode } from '../lib/types'

// AI Slop Meter Background Service Worker Initialized

const CACHE_TTL_MS = 60 * 60 * 1000
const MAX_SAMPLED_FILES = 28
const FILE_FETCH_CONCURRENCY = 4

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ANALYZE_REPO') {
    handleAnalyzeRepo(message.payload, sender.tab?.id)
      .then((result) => sendResponse({ success: true, data: result }))
      .catch((error: Error) => sendResponse({ success: false, error: mapError(error) }))
    return true
  }
})

async function handleAnalyzeRepo(payload: { owner: string; repo: string }, senderTabId?: number): Promise<RepoAnalysis> {
  const { owner, repo } = payload
  const repoId = `${owner}/${repo}`
  const token = await getToken()
  const startedAt = Date.now()
  let requestCount = 0

  const withCount = async <T>(promiseFactory: () => Promise<T>): Promise<T> => {
    requestCount++
    return promiseFactory()
  }

  const repoInfo = await withCount(() => fetchRepoInfo(owner, repo, token))
  const commits = await withCount(() => fetchCommitHistory(owner, repo, token))
  const latestCommitSha = commits[0]?.sha ?? 'no-commits'
  const cacheKey = `${repoId}:${repoInfo.default_branch}:${latestCommitSha}`

  const cached = await getCachedAnalysisByKey(cacheKey)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return {
      ...cached,
      cache: {
        ...cached.cache,
        isCached: true,
        cacheKey,
      },
    }
  }

  const commitResult = analyzeCommitMessages(commits)
  const provisionalIndicators = [...commitResult.indicators]
  const provisionalScore = calculateSlopScore({
    configSignal: 0,
    commitLanguageSignal: commitResult.aiSignal,
    commitBurstSignal: Math.max(commitResult.burstSignal, commitResult.bulkSignal * 0.8),
    commentPatternSignal: 0,
    repetitionSignal: 0,
    structureUniformitySignal: 0,
    evidenceSignals: signalCount([
      commitResult.aiSignal,
      commitResult.burstSignal,
      commitResult.bulkSignal,
    ]),
    signalValues: [
      commitResult.aiSignal,
      Math.max(commitResult.burstSignal, commitResult.bulkSignal * 0.8),
    ],
    indicatorCount: provisionalIndicators.length,
    mediumHighIndicatorCount: provisionalIndicators.filter((indicator) => indicator.severity !== 'low').length,
  })

  const provisionalAnalysis: RepoAnalysis = {
    repoId,
    repoName: `${owner}/${repo}`,
    slopScore: provisionalScore.overall,
    confidence: provisionalScore.confidence,
    stage: 'provisional',
    semantics: 'likelihood',
    indicators: provisionalIndicators,
    scoreBreakdown: provisionalScore.breakdown,
    diagnostics: {
      timingMs: {
        startedAt,
        timeToFirstBadge: Date.now() - startedAt,
      },
      requestCount,
      sampledFiles: 0,
      featureValues: {
        configSignal: 0,
        commitLanguageSignal: round(commitResult.aiSignal),
        commitBurstSignal: round(Math.max(commitResult.burstSignal, commitResult.bulkSignal * 0.8)),
        commentPatternSignal: 0,
        repetitionSignal: 0,
        structureUniformitySignal: 0,
      },
      scoreContributions: provisionalScore.contributions,
      evidenceStrength: provisionalScore.evidenceStrength,
    },
    cache: {
      isCached: false,
      cacheKey,
    },
    timestamp: Date.now(),
  }

  void runDeepAnalysis({
    owner,
    repo,
    repoId,
    repoInfo,
    defaultBranch: repoInfo.default_branch,
    token,
    startedAt,
    initialRequestCount: requestCount,
    commitResult,
    provisionalAnalysis,
    cacheKey,
    senderTabId,
  })

  return provisionalAnalysis
}

async function runDeepAnalysis(input: {
  owner: string
  repo: string
  repoId: string
  repoInfo: {
    created_at?: string
    stargazers_count?: number
  }
  defaultBranch: string
  token?: string
  startedAt: number
  initialRequestCount: number
  commitResult: ReturnType<typeof analyzeCommitMessages>
  provisionalAnalysis: RepoAnalysis
  cacheKey: string
  senderTabId?: number
}): Promise<void> {
  const {
    owner,
    repo,
    repoId,
    repoInfo,
    defaultBranch,
    token,
    startedAt,
    initialRequestCount,
    commitResult,
    provisionalAnalysis,
    cacheKey,
    senderTabId,
  } = input

  let requestCount = initialRequestCount
  const withCount = async <T>(promiseFactory: () => Promise<T>): Promise<T> => {
    requestCount++
    return promiseFactory()
  }

  try {
    const files = await withCount(() => fetchRepoTree(owner, repo, defaultBranch, token))
    const configResult = detectConfigFiles(files)
    const structureResult = detectBoilerplateStructure(files)

    const analyzableFiles = files.filter(
      (file) =>
        file.type === 'file' &&
        /(\.ts|\.tsx|\.js|\.jsx|\.py|\.go|\.rs|\.java|\.cs|\.rb|\.md|\.txt|\.yml|\.yaml|\.json|\.toml|\.ini)$/i.test(file.name)
    )

    const sampledFiles = pickSampleFiles(analyzableFiles, MAX_SAMPLED_FILES)
    const sampledContent = await mapWithConcurrency(sampledFiles, FILE_FETCH_CONCURRENCY, async (file) => {
      try {
        const content = await withCount(() => fetchFileContent(owner, repo, file.path, defaultBranch, token))
        return { path: file.path, content }
      } catch (error) {
        console.error(`Error fetching file content for ${file.path}:`, error)
        return null
      }
    })

    const validSamples = sampledContent.filter((sample): sample is { path: string; content: string } => Boolean(sample))

    let commentSignalTotal = 0
    let commentSignalMax = 0
    let commentSignalHits = 0
    let totalMatchedCommentLines = 0
    let codePatternSignalTotal = 0
    let codePatternSignalMax = 0
    let verboseCommentBlocks = 0
    const codePatternFiles: Array<{ path: string; matches: number }> = []
    let codePatternTotalMatches = 0

    for (const sample of validSamples) {
      const isCodeFile = /\.(ts|tsx|js|jsx|py|go|rs|java|cs|rb)$/i.test(sample.path)
      const commentResult = isCodeFile
        ? detectVerboseComments(sample.content)
        : { verboseBlocks: 0, matchedLines: 0, commentSignal: 0, indicators: [] as SlopIndicator[] }
      const codePatternResult = detectCodePatterns(sample.path, sample.content)
      verboseCommentBlocks += commentResult.verboseBlocks
      totalMatchedCommentLines += commentResult.matchedLines
      commentSignalTotal += commentResult.commentSignal
      commentSignalMax = Math.max(commentSignalMax, commentResult.commentSignal)
      if (commentResult.matchedLines > 0) commentSignalHits++
      codePatternSignalTotal += codePatternResult.signal
      codePatternSignalMax = Math.max(codePatternSignalMax, codePatternResult.signal)
      codePatternTotalMatches += codePatternResult.patternMatches
      if (codePatternResult.patternMatches > 0) {
        codePatternFiles.push({ path: sample.path, matches: codePatternResult.patternMatches })
      }
    }

    const repetitionResult = detectRepetition(validSamples)
    const pathKeywordMatches = files.filter(
      (file) =>
        file.type === 'file' &&
        /(?:^|\/)(?:ai|copilot|cursor|claude|chatgpt|gpt|openai|llm|prompt|prompts|instructions?)(?:\/|\.|_|-)/i.test(file.path)
    ).length
    const aiWorkflowPathMatches = files.filter(
      (file) =>
        file.type === 'file' &&
        /(\.opencode\/|\.cursor\/|\.aider\/|\.github\/copilot|AGENTS\.md|CLAUDE\.md|openspec)/i.test(file.path)
    ).length
    const pathKeywordSignal = boundedScale(pathKeywordMatches, 1, 12)
    const workflowPathSignal = boundedScale(aiWorkflowPathMatches, 1, 10)

    const baseConfigSignal = configResult.found ? Math.min(0.45 + (configResult.files.length * 0.2), 1) : 0
    const configSignalRaw = clamp(baseConfigSignal + (pathKeywordSignal * 0.4) + (workflowPathSignal * 0.5), 0, 1)
    const sampleCount = Math.max(validSamples.length, 1)
    const commentAvg = ratioSafe(commentSignalTotal, sampleCount)
    const codePatternAvg = ratioSafe(codePatternSignalTotal, sampleCount)
    const commentHitRate = ratioSafe(commentSignalHits, sampleCount)
    const commentPatternSignal = clamp(
      (commentAvg * 0.35) +
        (commentSignalMax * 0.25) +
        (codePatternAvg * 0.15) +
        (codePatternSignalMax * 0.1) +
        (boundedScale(commentHitRate, 0.08, 0.45) * 0.1) +
        (boundedScale(totalMatchedCommentLines, 3, 24) * 0.25),
      0,
      1
    )

    const isLegacyRepo = isLikelyLegacyRepo(repoInfo)

    let commitLanguageSignal = commitResult.aiSignal
    let commitBurstSignal = Math.max(commitResult.burstSignal, commitResult.bulkSignal * 0.8)
    let configSignal = configSignalRaw
    if (isLegacyRepo && totalMatchedCommentLines < 6 && codePatternTotalMatches < 10 && configResult.files.length === 0) {
      commitLanguageSignal *= 0.62
      commitBurstSignal *= 0.65
      configSignal = Math.min(configSignal, 0.18)
    }

    const indicators = dedupeIndicators([
      ...commitResult.indicators,
      ...(totalMatchedCommentLines > 0
        ? [
            {
              type: 'Prompt-like Comment Pattern',
              description: `Detected ${totalMatchedCommentLines} AI-like comment lines across ${verboseCommentBlocks} block(s)`,
              severity: totalMatchedCommentLines >= 8 ? 'high' : totalMatchedCommentLines >= 3 ? 'medium' : 'low',
            } as SlopIndicator,
          ]
        : []),
      ...(codePatternTotalMatches > 0
        ? [
            {
              type: 'AI Boilerplate Trace',
              description: `${codePatternTotalMatches} prompt-like marker(s) across ${codePatternFiles.length} file(s)`,
              severity: codePatternTotalMatches >= 12 ? 'high' : codePatternTotalMatches >= 4 ? 'medium' : 'low',
            } as SlopIndicator,
            {
              type: 'AI Boilerplate Trace',
              description: `Top files: ${codePatternFiles
                .sort((a, b) => b.matches - a.matches)
                .slice(0, 3)
                .map((entry) => `${entry.path} (${entry.matches})`)
                .join(', ')}`,
              severity: 'low',
            } as SlopIndicator,
          ]
        : []),
      ...repetitionResult.indicators,
      ...structureResult.indicators,
      ...(pathKeywordMatches > 0
        ? [
            {
              type: 'AI-oriented File Paths',
              description: `${pathKeywordMatches} file path(s) reference AI/prompt/instruction keywords`,
              severity: pathKeywordMatches >= 4 ? 'medium' : 'low',
            } as SlopIndicator,
          ]
        : []),
      ...(aiWorkflowPathMatches > 0
        ? [
            {
              type: 'AI Workflow Files',
              description: `${aiWorkflowPathMatches} workflow/instruction file path(s) detected`,
              severity: aiWorkflowPathMatches >= 3 ? 'medium' : 'low',
            } as SlopIndicator,
          ]
        : []),
      ...(configResult.found
        ? [
            {
              type: 'AI Config Files',
              description: `Found AI config files: ${configResult.files.join(', ')}`,
              severity: configResult.severity,
            } as SlopIndicator,
          ]
        : []),
      ...(isLegacyRepo
        ? [
            {
              type: 'Legacy Repo Dampener',
              description: 'Reduced commit/path-only confidence for long-established repository history',
              severity: 'low',
            } as SlopIndicator,
          ]
        : []),
    ])

    const scoring = calculateSlopScore({
      configSignal,
      commitLanguageSignal,
      commitBurstSignal,
      commentPatternSignal,
      repetitionSignal: repetitionResult.repetitionSignal,
      structureUniformitySignal: structureResult.uniformitySignal,
      evidenceSignals: signalCount([
        configSignal,
        commitLanguageSignal,
        commitBurstSignal,
        commentPatternSignal,
        repetitionResult.repetitionSignal,
        structureResult.uniformitySignal,
        workflowPathSignal,
      ]),
      signalValues: [
        configSignal,
        commitLanguageSignal,
        commitBurstSignal,
        commentPatternSignal,
        repetitionResult.repetitionSignal,
        structureResult.uniformitySignal,
        workflowPathSignal,
      ],
      indicatorCount: indicators.length,
      mediumHighIndicatorCount: indicators.filter((indicator) => indicator.severity !== 'low').length,
    })

    const finalAnalysis: RepoAnalysis = {
      repoId,
      repoName: `${owner}/${repo}`,
      slopScore: scoring.overall,
      confidence: scoring.confidence,
      stage: 'final',
      semantics: 'likelihood',
      indicators,
      scoreBreakdown: scoring.breakdown,
      diagnostics: {
        timingMs: {
          startedAt,
          timeToFirstBadge: provisionalAnalysis.diagnostics.timingMs.timeToFirstBadge,
          timeToFinalScore: Date.now() - startedAt,
        },
        requestCount,
        sampledFiles: validSamples.length,
        featureValues: {
          configSignal: round(configSignal),
          commitLanguageSignal: round(commitLanguageSignal),
          commitBurstSignal: round(commitBurstSignal),
          commentPatternSignal: round(commentPatternSignal),
          repetitionSignal: round(repetitionResult.repetitionSignal),
          structureUniformitySignal: round(structureResult.uniformitySignal),
          pathKeywordSignal: round(pathKeywordSignal),
          pathKeywordMatches,
          workflowPathSignal: round(workflowPathSignal),
          aiWorkflowPathMatches,
          legacyRepoDampener: isLegacyRepo ? 1 : 0,
          verboseCommentBlocks,
          matchedCommentLines: totalMatchedCommentLines,
          commentHitRate: round(commentHitRate),
          repeatedShapes: structureResult.repeatedShapes,
          averageSimilarity: round(repetitionResult.averageSimilarity),
        },
        scoreContributions: scoring.contributions,
        evidenceStrength: scoring.evidenceStrength,
      },
      cache: {
        isCached: false,
        cacheKey,
      },
      timestamp: Date.now(),
    }

    await cacheAnalysisByKey(cacheKey, finalAnalysis)
    await publishAnalysisUpdate(finalAnalysis, senderTabId)
  } catch (error) {
    console.error('Deep analysis failed:', error)
    const failedAnalysis: RepoAnalysis = {
      ...provisionalAnalysis,
      stage: 'final',
      confidence: 'low',
      indicators: dedupeIndicators([
        ...provisionalAnalysis.indicators,
        {
          type: 'Deep Analysis Incomplete',
          description: 'Final pass did not complete; showing provisional likelihood only',
          severity: 'low',
        },
      ]),
      diagnostics: {
        ...provisionalAnalysis.diagnostics,
        timingMs: {
          ...provisionalAnalysis.diagnostics.timingMs,
          timeToFinalScore: Date.now() - startedAt,
        },
      },
      timestamp: Date.now(),
    }

    await publishAnalysisUpdate(failedAnalysis, senderTabId)
  }
}

async function publishAnalysisUpdate(analysis: RepoAnalysis, tabId?: number): Promise<void> {
  if (typeof tabId === 'number') {
    try {
      await chrome.tabs.sendMessage(tabId, {
        type: 'ANALYSIS_UPDATE',
        payload: analysis,
      })
    } catch {
      // Tab may no longer have content listener; popup still receives runtime broadcast.
    }
  }

  try {
    await chrome.runtime.sendMessage({
      type: 'ANALYSIS_UPDATE',
      payload: analysis,
    })
  } catch {
    // No active listeners.
  }
}

function pickSampleFiles(files: FileNode[], maxFiles: number): FileNode[] {
  if (files.length <= maxFiles) return files

  const priorityPattern = /(ai|copilot|cursor|claude|gpt|prompt|instruction|generated|scaffold|template|readme|contributing|guide)/i
  const rootFiles = files.filter((file) => !file.path.includes('/'))
  const prioritized = files.filter((file) => priorityPattern.test(file.path))
  const rest = files.filter((file) => !priorityPattern.test(file.path) && !rootFiles.includes(file))

  const selection: FileNode[] = []
  const pushUnique = (file: FileNode) => {
    if (selection.find((item) => item.path === file.path)) return
    selection.push(file)
  }

  for (const file of prioritized) {
    if (selection.length >= Math.ceil(maxFiles * 0.45)) break
    pushUnique(file)
  }
  for (const file of rootFiles) {
    if (selection.length >= Math.ceil(maxFiles * 0.6)) break
    pushUnique(file)
  }

  const remainingSlots = maxFiles - selection.length
  if (remainingSlots <= 0) return selection.slice(0, maxFiles)

  const step = rest.length / remainingSlots
  for (let i = 0; i < remainingSlots; i++) {
    const item = rest[Math.floor(i * step)]
    if (item) pushUnique(item)
  }

  return selection.slice(0, maxFiles)
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const output: R[] = new Array(items.length)
  let index = 0

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const currentIndex = index
      index++
      output[currentIndex] = await mapper(items[currentIndex])
    }
  })

  await Promise.all(workers)
  return output
}

function mapError(error: Error): string {
  if (error instanceof GitHubApiError) {
    if (error.status === 403) return 'RATE_LIMIT: GitHub API rate limit reached. Add token in settings.'
    if (error.status === 401 || error.status === 404) return 'AUTH_REQUIRED: Repository may be private or requires a token.'
    return `API_ERROR: ${error.message}`
  }

  return `NETWORK_ERROR: ${error.message}`
}

function dedupeIndicators(indicators: SlopIndicator[]): SlopIndicator[] {
  const seen = new Set<string>()
  const deduped: SlopIndicator[] = []

  for (const indicator of indicators) {
    const key = `${indicator.type}:${indicator.description}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(indicator)
  }

  return deduped
}

function signalCount(values: number[]): number {
  return values.filter((value) => value >= 0.2).length
}

function ratioSafe(value: number, divisor: number): number {
  if (divisor <= 0) return 0
  return value / divisor
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min
  if (value > max) return max
  return value
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function isLikelyLegacyRepo(repoInfo: { created_at?: string; stargazers_count?: number }): boolean {
  if (!repoInfo.created_at) return false
  const createdAt = new Date(repoInfo.created_at).getTime()
  if (Number.isNaN(createdAt)) return false
  const legacyCutoff = new Date('2020-01-01T00:00:00.000Z').getTime()
  const stars = repoInfo.stargazers_count ?? 0
  return createdAt < legacyCutoff && stars >= 150
}
