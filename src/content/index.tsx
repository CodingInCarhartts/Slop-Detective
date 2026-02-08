// AI Slop Meter Content Script Initialized

let badgeContainer: HTMLElement | null = null
let lastUrl = window.location.href
let isAnalyzing = false
let queuedAnalyze = false
let currentRepoId: string | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let badgeRetryTimer: ReturnType<typeof setInterval> | null = null
let pendingBadge: { label: string; tone: BadgeTone } | null = null

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

function buildBadgeMarkup(label: string, tone: BadgeTone): string {
  const style = badgeStyle(tone)
  return `
    <div class="ai-slop-meter-badge" style="
      display: inline-flex;
      align-items: center;
      padding: 4px 12px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 600;
      margin-left: 8px;
      background-color: ${style.background};
      color: ${style.color};
      border: 1px solid ${style.border};
      white-space: nowrap;
    ">
      <span>${label}</span>
    </div>
  `
}

function mountBadge(label: string, tone: BadgeTone): boolean {
  const header = findHeader()
  if (!header) return false

  const actionsContainer = header.querySelector('ul.pagehead-actions, [class*="actions"]')

  if (!badgeContainer || !badgeContainer.isConnected) {
    badgeContainer = document.createElement('div')
    badgeContainer.className = 'd-flex flex-items-center ml-3 ai-slop-meter-container'
  }

  badgeContainer.innerHTML = buildBadgeMarkup(label, tone)

  if (actionsContainer) {
    actionsContainer.prepend(badgeContainer)
  } else {
    header.appendChild(badgeContainer)
  }

  return true
}

function injectBadge(label: string, tone: BadgeTone) {
  pendingBadge = { label, tone }
  if (mountBadge(label, tone)) {
    pendingBadge = null
  }
}

function retryPendingBadge() {
  if (!pendingBadge) return
  if (mountBadge(pendingBadge.label, pendingBadge.tone)) {
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
  if (badgeContainer && badgeContainer.isConnected) {
    badgeContainer.remove()
  }

  void analyzeRepo()
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
  if (!currentRepoId || message.payload.repoId !== currentRepoId) return
  renderAnalysisBadge(message.payload.slopScore, message.payload.stage)
})

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setupNavigationListeners()
    void analyzeRepo()
  })
} else {
  setupNavigationListeners()
  void analyzeRepo()
}

window.addEventListener('beforeunload', () => {
  if (pollTimer) clearInterval(pollTimer)
  if (badgeRetryTimer) clearInterval(badgeRetryTimer)
})
