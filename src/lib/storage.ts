import type { Settings, RepoAnalysis } from './types'

const SETTINGS_KEY = 'ai-slop-meter-settings'
const CACHE_KEY_PREFIX = 'ai-slop-meter-cache-'

export async function saveToken(token: string): Promise<void> {
  const settings = await getSettings()
  const newSettings: Settings = { ...settings, githubToken: token }
  await chrome.storage.local.set({ [SETTINGS_KEY]: newSettings })
}

export async function getToken(): Promise<string | undefined> {
  const settings = await getSettings()
  return settings.githubToken
}

export async function getSettings(): Promise<Settings> {
  const result = await chrome.storage.local.get(SETTINGS_KEY)
  const settings = result[SETTINGS_KEY] as Settings | undefined
  return {
    autoAnalyze: settings?.autoAnalyze ?? false,
    darkMode: settings?.darkMode ?? false,
    githubToken: settings?.githubToken,
  }
}

export async function cacheAnalysis(repoId: string, data: RepoAnalysis): Promise<void> {
  const key = `${CACHE_KEY_PREFIX}${repoId}`
  await chrome.storage.local.set({ [key]: data })
}

export async function getCachedAnalysis(repoId: string): Promise<RepoAnalysis | null> {
  const key = `${CACHE_KEY_PREFIX}${repoId}`
  const result = await chrome.storage.local.get(key)
  const analysis = result[key] as RepoAnalysis | undefined
  return analysis || null
}

export async function cacheAnalysisByKey(cacheKey: string, data: RepoAnalysis): Promise<void> {
  const key = `${CACHE_KEY_PREFIX}${cacheKey}`
  await chrome.storage.local.set({ [key]: data })
}

export async function getCachedAnalysisByKey(cacheKey: string): Promise<RepoAnalysis | null> {
  const key = `${CACHE_KEY_PREFIX}${cacheKey}`
  const result = await chrome.storage.local.get(key)
  const analysis = result[key] as RepoAnalysis | undefined
  return analysis || null
}

export async function clearAnalysisCache(): Promise<number> {
  const allItems = await chrome.storage.local.get(null)
  const cacheKeys = Object.keys(allItems).filter((key) => key.startsWith(CACHE_KEY_PREFIX))
  if (cacheKeys.length > 0) {
    await chrome.storage.local.remove(cacheKeys)
  }
  return cacheKeys.length
}
