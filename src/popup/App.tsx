import { useEffect, useMemo, useState, type SVGProps } from 'react'
import { ScoreGauge } from '@/components/ScoreGauge'
import { SlopBadge } from '@/components/SlopBadge'
import { clearAnalysisCache, getSettings } from '@/lib/storage'
import type { RepoAnalysis, Settings } from '@/lib/types'
import { Activity, ChevronLeft, Sparkles } from 'lucide-react'

type View = 'main' | 'settings' | 'analysis'
type BannerTone = 'error' | 'warning' | 'info'

interface BannerState {
  message: string
  tone: BannerTone
}

function App() {
  const [view, setView] = useState<View>('main')
  const [settings, setSettings] = useState<Settings>({ autoAnalyze: false, darkMode: false })
  const [token, setToken] = useState('')
  const [analysis, setAnalysis] = useState<RepoAnalysis | null>(null)
  const [loading, setLoading] = useState(false)
  const [banner, setBanner] = useState<BannerState | null>(null)
  const [clearingCache, setClearingCache] = useState(false)

  useEffect(() => {
    void loadSettings()
  }, [])

  useEffect(() => {
    const listener = (message: { type?: string; payload?: RepoAnalysis }) => {
      if (message.type !== 'ANALYSIS_UPDATE' || !message.payload) return
      const payload = message.payload
      if (analysis && payload.repoId !== analysis.repoId) return

      setAnalysis(payload)
      setView('analysis')
      setLoading(false)
      setBanner((prev) => {
        if (prev?.tone === 'error') return prev
        if (payload.stage === 'final' && payload.confidence === 'low') {
          return {
            tone: 'warning',
            message: 'Low confidence: evidence is weak.',
          }
        }
        return null
      })
    }

    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [analysis])

  async function loadSettings() {
    const loadedSettings = await getSettings()
    setSettings(loadedSettings)
    if (loadedSettings.githubToken) setToken(loadedSettings.githubToken)
  }

  async function handleSaveSettings() {
    await chrome.storage.local.set({
      'ai-slop-meter-settings': {
        ...settings,
        githubToken: token,
      },
    })
    setBanner({ tone: 'info', message: 'CASES UPDATED.' })
    setView('main')
  }

  async function handleClearCache() {
    setClearingCache(true)
    try {
      const removedEntries = await clearAnalysisCache()
      setBanner({ tone: 'info', message: `CACHE PURGED: ${removedEntries} FILE${removedEntries === 1 ? '' : 'S'} REMOVED.` })
    } catch {
      setBanner({ tone: 'error', message: 'CACHE PURGE FAILED.' })
    } finally {
      setClearingCache(false)
    }
  }

  async function handleAnalyze() {
    setLoading(true)
    setBanner(null)

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab.url || !tab.url.includes('github.com')) {
        setBanner({ tone: 'warning', message: 'ERROR: NOT GITHUB.' })
        setLoading(false)
        return
      }

      const url = new URL(tab.url)
      const pathParts = url.pathname.split('/').filter(Boolean)
      if (pathParts.length < 2) {
        setBanner({ tone: 'warning', message: 'ERROR: REPO ROOT.' })
        setLoading(false)
        return
      }

      const owner = pathParts[0]
      const repo = pathParts[1]
      const response = await chrome.runtime.sendMessage({
        type: 'ANALYZE_REPO',
        payload: { owner, repo },
      })

      if (!response.success) {
        setBanner(parseAnalysisError(response.error))
        setLoading(false)
        return
      }

      const result = response.data as RepoAnalysis
      setAnalysis(result)
      setView('analysis')
      setLoading(false)
    } catch {
      setBanner({ tone: 'error', message: 'SYSTEM FAILURE.' })
      setLoading(false)
    }
  }

  const timestampLabel = useMemo(() => {
    if (!analysis?.timestamp) return ''
    return new Date(analysis.timestamp).toLocaleDateString()
  }, [analysis?.timestamp])

  const shellHeader = (
    <header className="relative mb-4 border-b-2 border-ink pb-3 transform -rotate-1">
      <h1 className="font-display text-[2.2rem] font-black uppercase leading-[0.9] tracking-tighter text-ink">
        Slop<br />Detective
      </h1>
      <div className="mt-1 flex justify-between text-[0.7rem] font-bold uppercase">
        <span>Target: {analysis ? analysis.repoName : 'Current Tab'}</span>
        <span className="bg-ink px-1.5 py-0.5 text-[0.6rem] text-paper">V.{chrome.runtime.getManifest().version}</span>
      </div>
    </header>
  )

  const shellFooter = (
    <footer className="mt-auto flex gap-2.5 pt-4">
      {view === 'analysis' ? (
        <>
          <button 
            onClick={() => setView('main')} 
            className="flex h-12 w-12 items-center justify-center border-2 border-ink transition-all hover:-translate-y-0.5 hover:shadow-[4px_4px_0px_var(--color-alert)] active:translate-y-0 active:shadow-none"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button 
            onClick={handleAnalyze} 
            disabled={loading} 
            className="flex-1 bg-ink text-paper h-12 border-2 border-ink font-mono font-bold uppercase text-xs transition-all hover:-translate-y-0.5 hover:shadow-[4px_4px_0px_var(--color-alert)] active:translate-y-0 active:shadow-none disabled:opacity-50"
          >
            {loading ? <Activity className="inline mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="inline mr-2 h-4 w-4" />}
            Re-Examine
          </button>
        </>
      ) : view === 'settings' ? (
        <>
          <button 
            onClick={() => setView('main')} 
            className="flex-1 border-2 border-ink h-12 font-mono font-bold uppercase text-xs transition-all hover:-translate-y-0.5 hover:shadow-[4px_4px_0px_var(--color-alert)] active:translate-y-0 active:shadow-none"
          >
            Abort
          </button>
          <button 
            onClick={handleSaveSettings} 
            className="flex-1 bg-ink text-paper h-12 border-2 border-ink font-mono font-bold uppercase text-xs transition-all hover:-translate-y-0.5 hover:shadow-[4px_4px_0px_var(--color-alert)] active:translate-y-0 active:shadow-none"
          >
            File Away
          </button>
        </>
      ) : (
        <>
          <button 
            onClick={handleAnalyze} 
            disabled={loading} 
            className="flex-[2] bg-ink text-paper h-12 border-2 border-ink font-mono font-bold uppercase text-xs transition-all hover:-translate-y-0.5 hover:shadow-[4px_4px_0px_var(--color-alert)] active:translate-y-0 active:shadow-none disabled:opacity-50"
          >
            {loading ? <Activity className="inline mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="inline mr-2 h-4 w-4" />}
            Scan Target
          </button>
          <button 
            onClick={() => setView('settings')} 
            className="flex-1 border-2 border-ink h-12 font-mono font-bold uppercase text-xs transition-all hover:-translate-y-0.5 hover:shadow-[4px_4px_0px_var(--color-alert)] active:translate-y-0 active:shadow-none"
          >
            Files
          </button>
        </>
      )}
    </footer>
  )

  return (
    <div className={`popup-shell p-5 relative overflow-hidden${settings.darkMode ? ' dark-mode' : ''}`}>
      <div className="texture-overlay" />
      <div className="vignette" />
      <div className="scanline" />
      <div className="tape" />
      <div className="coffee-stain" />

      <div className="relative z-20 flex h-full flex-col">
        {shellHeader}

        <div className="flex-1 overflow-y-auto pr-1">
          {banner ? (
            <div className={bannerClassName(banner.tone)}>
              <span className="highlight-text">{banner.message}</span>
            </div>
          ) : null}

          {view === 'settings' ? (
            <div className="space-y-4 py-2">
              <div className="border-2 border-ink p-4 bg-paper-dark shadow-[4px_4px_0px_var(--color-ink)]">
                <h3 className="text-xs font-bold uppercase mb-3">Target Identification</h3>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-[0.6rem] font-bold uppercase opacity-50">API Credential</label>
                    <input
                      type="password"
                      value={token}
                      onChange={(event) => setToken(event.target.value)}
                      placeholder="ghp_****************"
                      className="w-full border-b-2 border-ink bg-transparent py-1 text-xs font-mono focus:outline-none focus:border-alert placeholder:opacity-20"
                    />
                  </div>
                  <div className="flex items-center justify-between pt-2">
                    <span className="text-xs font-bold uppercase">Field Auto-Scan</span>
                    <input
                      type="checkbox"
                      checked={settings.autoAnalyze}
                      className="accent-alert"
                      onChange={(event) => setSettings({ ...settings, autoAnalyze: event.target.checked })}
                    />
                  </div>
                </div>
              </div>

              <div className="border-2 border-ink p-4 bg-paper-dark shadow-[4px_4px_0px_var(--color-ink)]">
                <h3 className="text-xs font-bold uppercase mb-3">Display Options</h3>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase">Dark Mode</span>
                  <input
                    type="checkbox"
                    checked={settings.darkMode}
                    className="accent-alert"
                    onChange={(event) => setSettings({ ...settings, darkMode: event.target.checked })}
                  />
                </div>
              </div>

              <div className="border-2 border-ink p-4 bg-paper-dark shadow-[4px_4px_0px_var(--color-ink)]">
                <h3 className="text-xs font-bold uppercase mb-3">Cache Maintenance</h3>
                <button
                  onClick={handleClearCache}
                  disabled={clearingCache}
                  className="w-full border-2 border-ink h-10 font-mono font-bold uppercase text-[0.65rem] transition-all hover:-translate-y-0.5 hover:shadow-[4px_4px_0px_var(--color-alert)] active:translate-y-0 active:shadow-none disabled:opacity-50"
                >
                  {clearingCache ? 'Purging...' : 'Clear Analysis Cache'}
                </button>
              </div>
            </div>
          ) : view === 'analysis' && analysis ? (
            <div className="space-y-4 py-2">
              <div className="relative bg-paper-dark border-2 border-ink shadow-[5px_5px_0px_var(--color-ink)] p-4 overflow-hidden min-h-[140px] flex flex-col items-center justify-center">
                <div className="absolute w-[200px] h-[200px] border border-dashed border-ink/20 rounded-full animate-[spin_20s_linear_infinite]" />
                <div className="relative z-10 font-display text-[4.5rem] font-black text-alert leading-none mix-blend-multiply drop-shadow-sm">
                  {analysis.slopScore}<span className="text-2xl ml-1">%</span>
                </div>
                <SlopBadge score={analysis.slopScore} />
              </div>

              <div className="space-y-2 py-2">
                <div className="flex justify-between text-[0.6rem] font-bold opacity-50 uppercase border-b border-ink pb-1">
                  <span>Dossier: {analysis.repoId.substring(0, 8)}</span>
                  <span>Date: {timestampLabel}</span>
                </div>

                <div className="space-y-2">
                  <ScoreGauge score={analysis.slopScore} showLabel={false} />
                  <div className="grid grid-cols-2 gap-2 text-[0.6rem] font-bold uppercase">
                    <div className="border-b border-dotted border-ink pb-1">Certainty: {analysis.confidence}</div>
                    <div className="border-b border-dotted border-ink pb-1 text-right">Evidence: {analysis.diagnostics.evidenceStrength}</div>
                    <div className="border-b border-dotted border-ink pb-1">Stage: {analysis.stage}</div>
                    <div className="border-b border-dotted border-ink pb-1 text-right">Cache: {analysis.cache.isCached ? 'Hit' : 'Live'}</div>
                    <div className="border-b border-dotted border-ink pb-1">Samples: {analysis.diagnostics.sampledFiles}</div>
                    <div className="border-b border-dotted border-ink pb-1 text-right">Req: {analysis.diagnostics.requestCount}</div>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-[0.65rem] font-black uppercase tracking-widest bg-ink text-paper px-2 py-0.5 inline-block">Neural Patterns</h3>
                <div className="space-y-1">
                  {analysis.diagnostics.scoreContributions.map((contribution, i) => (
                    <div key={i} className="grid grid-cols-[1fr_40px] gap-2 border-b border-dotted border-ink pb-1 group">
                      <div className="flex flex-col">
                        <span className="text-[0.65rem] font-bold uppercase">{contribution.feature}</span>
                        <span className="text-[0.55rem] leading-none opacity-40 group-hover:opacity-100 transition-opacity italic">{contribution.notes}</span>
                      </div>
                      <span className="text-xs font-bold text-alert text-right">+{contribution.contribution}%</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-[0.65rem] font-black uppercase tracking-widest bg-ink text-paper px-2 py-0.5 inline-block">Detected Indicators</h3>
                <div className="max-h-40 overflow-y-auto space-y-2 pr-1">
                  {analysis.indicators.length === 0 ? (
                    <div className="border border-dotted border-ink/50 p-2 text-[0.65rem] font-bold uppercase opacity-60">
                      No strong indicators detected.
                    </div>
                  ) : (
                    analysis.indicators.map((indicator, index) => (
                      <div key={`${indicator.type}-${index}`} className="border border-dotted border-ink/50 p-2 bg-paper/60">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[0.65rem] font-bold uppercase">{indicator.type}</span>
                          <span className={`text-[0.55rem] font-bold uppercase ${indicator.severity === 'high' ? 'text-alert' : indicator.severity === 'medium' ? 'text-amber-700' : 'text-blue-ink'}`}>
                            {indicator.severity}
                          </span>
                        </div>
                        <p className="mt-1 text-[0.6rem] leading-tight opacity-80">{indicator.description}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div style={{ fontStyle: 'italic', fontSize: '0.7rem', color: 'var(--color-blue-ink)', transform: 'rotate(-2deg)', opacity: 0.7 }} className="pt-2 font-serif">
                 "Syntax looks rigid. Probable LLM garbage."
              </div>
            </div>
          ) : (
            <div className="flex h-48 flex-col items-center justify-center text-center opacity-40">
              <Goggles className="h-16 w-16 mb-4" />
              <h2 className="text-sm font-black uppercase tracking-widest">Awaiting Case</h2>
              <p className="text-[0.6rem] font-bold uppercase">Analyze a repository to begin investigation</p>
            </div>
          )}
        </div>

        {shellFooter}
      </div>
    </div>
  )
}

function bannerClassName(tone: BannerTone): string {
  if (tone === 'error') return 'mb-4 text-xs font-bold text-alert animate-pulse'
  if (tone === 'warning') return 'mb-4 text-xs font-bold text-alert'
  return 'mb-4 text-xs font-bold text-blue-ink'
}

function parseAnalysisError(error?: string): BannerState {
  if (!error) return { tone: 'error', message: 'ANALYSIS FAILED.' }
  if (error.startsWith('RATE_LIMIT:')) {
    return { tone: 'warning', message: 'RATE LIMIT HIT. ADD TOKEN IN SETTINGS.' }
  }
  if (error.startsWith('AUTH_REQUIRED:')) {
    return { tone: 'warning', message: 'TOKEN REQUIRED OR REPO IS PRIVATE.' }
  }
  if (error.startsWith('API_ERROR:')) {
    return { tone: 'error', message: error.replace('API_ERROR: ', 'API ERROR: ').toUpperCase() }
  }
  if (error.startsWith('NETWORK_ERROR:')) {
    return { tone: 'error', message: 'NETWORK ERROR. CHECK CONNECTION.' }
  }
  return { tone: 'error', message: error.toUpperCase() }
}

function RefreshCcw(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 16h5v5" />
    </svg>
  )
}

function Goggles(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="12" r="3"/><circle cx="18" cy="12" r="3"/><path d="M9 12h6"/><path d="M3 12h0"/><path d="M21 12h0"/><path d="M6 15c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2"/>
    </svg>
  )
}

export default App
