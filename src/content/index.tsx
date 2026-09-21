// AI Slop Meter Content Script Initialized

import { getSettings } from '../lib/storage'

let badgeContainer: HTMLElement | null = null
let lastUrl = window.location.href
let isAnalyzing = false
let queuedAnalyze = false
let currentRepoId: string | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let badgeRetryTimer: ReturnType<typeof setInterval> | null = null
let pendingBadge: { label: string; tone: BadgeTone } | null = null
let currentBadge: { label: string; tone: BadgeTone } | null = null

type BadgeTone = 'loading' | 'low' | 'moderate' | 'high'

function badgeStyle(tone: BadgeTone) {
  if (tone === 'loading') {
    return { background: '#e0f2fe', color: '#075985', border: '#bae6fd' }
  }
  if (tone === 'low') {
    return { background: '#dcfce7', color: '#166534', border: '#bbf7d0' }
  }
  if (tone === 'moderate') {
    return { background: '#fef9c3', color: '#854d0e', border: '#fde047' }
  }
  return { background: '#fee2e2', color: '#991b1b', border: '#fca5a5' }
}

function findHeader(): Element | null {
  return (
    document.querySelector('[data-testid="repository-container-header"]') ||
    document.querySelector('#repository-container-header') ||
    document.querySelector('.repohead') ||
    document.querySelector('[class*="repo-head"]')
  )
}

function findBadgeMountPoint(): { parent: Element; before: Element | null } | null {
  const header = findHeader()
  if (!header || !header.parentElement) return null

  let before = header.nextElementSibling
  while (before && (before.tagName === 'SCRIPT' || before.tagName === 'STYLE')) {
    before = before.nextElementSibling
  }

  return { parent: header.parentElement, before }
}

function buildBadgeMarkup(label: string, tone: BadgeTone): string {
  const style = badgeStyle(tone)
  return `
    <div class="${BADGE_CLASS}" style="
      display: inline-flex;
      align-items: center;
      padding: 6px 14px;
      border-radius: 9999px;
      font-size: 13px;
      font-weight: 600;
      background-color: ${style.background};
      color: ${style.color};
      border: 1px solid ${style.border};
      white-space: nowrap;
      box-shadow: 0 1px 2px rgba(0,0,0,0.05);
    ">
      <span>${label}</span>
    </div>
  `
}

const BADGE_CONTAINER_CLASS = 'ai-slop-meter-container'
const BADGE_CLASS = 'ai-slop-meter-badge'

/**
 * Removes all existing badge containers from the DOM.
 * This ensures no duplicate badges are created during navigation.
 */
function removeExistingBadges(): void {
  const existingContainers = document.querySelectorAll(`.${BADGE_CONTAINER_CLASS}`)
  existingContainers.forEach(container => container.remove())
}

function mountBadge(label: string, tone: BadgeTone): boolean {
  const mountPoint = findBadgeMountPoint()
  if (!mountPoint) return false

  // Always remove any existing badges before creating a new one
  // This handles cases where the badgeContainer reference becomes stale
  removeExistingBadges()

  // Create a fresh container
  badgeContainer = document.createElement('div')
  badgeContainer.className = `container-xl px-md-4 px-lg-5 px-3 ${BADGE_CONTAINER_CLASS}`
  badgeContainer.style.cssText = 'margin: 12px auto 14px auto; display: flex; align-items: center;'
  badgeContainer.innerHTML = buildBadgeMarkup(label, tone)

  const { parent, before } = mountPoint
  if (before) {
    parent.insertBefore(badgeContainer, before)
  } else {
    parent.appendChild(badgeContainer)
  }

  return badgeContainer.isConnected
}

function injectBadge(label: string, tone: BadgeTone) {
  currentBadge = { label, tone }
  pendingBadge = { label, tone }
  if (mountBadge(label, tone)) {
    pendingBadge = null
  }
}

function retryPendingBadge() {
  const badgeToRender = pendingBadge || currentBadge
  if (!badgeToRender) return
  if (mountBadge(badgeToRender.label, badgeToRender.tone)) {
    pendingBadge = null
  }
}

function getCurrentRepo() {
  const match = window.location.href.match(/github\.com\/([^/]+)\/([^/]+)/)
  if (!match) return null
  return { owner: match[1], repo: match[2], repoId: `${match[1]}/${match[2]}` }
}

function scoreTone(score: number): Exclude<BadgeTone, 'loading'> {
  if (score <= 20) return 'low'
  if (score <= 60) return 'moderate'
  return 'high'
}

function renderAnalysisBadge(score: number, stage: 'provisional' | 'final') {
  const stageLabel = stage === 'provisional' ? 'Provisional' : 'Final'
  injectBadge(`AI Likelihood: ${score}% (${stageLabel})`, scoreTone(score))
}

async function analyzeRepo() {
  if (isAnalyzing) {
    queuedAnalyze = true
    return
  }

  const repo = getCurrentRepo()
  if (!repo) return

  currentRepoId = repo.repoId
  isAnalyzing = true
  injectBadge('Analyzing...', 'loading')

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'ANALYZE_REPO',
      payload: { owner: repo.owner, repo: repo.repo },
    })

    if (!response.success) {
      injectBadge('Analysis unavailable', 'moderate')
      return
    }

    const analysis = response.data as { slopScore: number; stage: 'provisional' | 'final'; repoId: string }
    if (analysis.repoId === currentRepoId) {
      renderAnalysisBadge(analysis.slopScore, analysis.stage)
    }
  } catch (error) {
    console.error('Error analyzing repo:', error)
    injectBadge('Analysis error', 'moderate')
  } finally {
    isAnalyzing = false
    if (queuedAnalyze) {
      queuedAnalyze = false
      void analyzeRepo()
    }
  }
}

function handleUrlChange() {
  const currentUrl = window.location.href
  if (currentUrl === lastUrl) return

  lastUrl = currentUrl
  currentRepoId = null
  currentBadge = null
  pendingBadge = null

  // Thorough cleanup: remove all existing badges and clear the reference
  removeExistingBadges()
  badgeContainer = null

  // Only auto-analyze on URL change if autoAnalyze is enabled
  void shouldAutoAnalyze().then(shouldAnalyze => {
    if (shouldAnalyze) {
      void analyzeRepo()
    }
  })
}

async function shouldAutoAnalyze(): Promise<boolean> {
  const settings = await getSettings()
  return settings.autoAnalyze
}

function setupNavigationListeners() {
  const originalPushState = history.pushState.bind(history)
  history.pushState = (...args) => {
    originalPushState(...args)
    handleUrlChange()
  }

  const originalReplaceState = history.replaceState.bind(history)
  history.replaceState = (...args) => {
    originalReplaceState(...args)
    handleUrlChange()
  }

  window.addEventListener('popstate', handleUrlChange)
  window.addEventListener('pjax:end', handleUrlChange as EventListener)
  window.addEventListener('turbo:render', handleUrlChange as EventListener)
  window.addEventListener('turbo:visit', handleUrlChange as EventListener)

  // Lightweight fallback in case GitHub changes event behavior.
  pollTimer = setInterval(handleUrlChange, 1000)

  const title = document.querySelector('title')
  if (title) {
    const observer = new MutationObserver(() => {
      retryPendingBadge()
      handleUrlChange()
    })
    observer.observe(title, { childList: true })
  }

  badgeRetryTimer = setInterval(retryPendingBadge, 400)
}

chrome.runtime.onMessage.addListener((message: { type?: string; payload?: { repoId: string; slopScore: number; stage: 'provisional' | 'final' } }) => {
  if (message.type !== 'ANALYSIS_UPDATE' || !message.payload) return

  const repo = getCurrentRepo()
  if (!repo || message.payload.repoId !== repo.repoId) return

  currentRepoId = repo.repoId
  renderAnalysisBadge(message.payload.slopScore, message.payload.stage)
})

// Initialize: check autoAnalyze setting before running initial analysis
async function initialize() {
  setupNavigationListeners()
  
  const settings = await getSettings()
  if (settings.autoAnalyze) {
    void analyzeRepo()
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    void initialize()
  })
} else {
  void initialize()
}

window.addEventListener('beforeunload', () => {
  if (pollTimer) clearInterval(pollTimer)
  if (badgeRetryTimer) clearInterval(badgeRetryTimer)
})
