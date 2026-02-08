interface ScoreGaugeProps {
  score: number
  showLabel?: boolean
}

export function ScoreGauge({ score, showLabel = true }: ScoreGaugeProps) {
  return (
    <div className="space-y-3 w-full animate-in fade-in slide-in-from-left-4 duration-1000">
      {showLabel && (
        <div className="flex items-center justify-between">
          <span className="text-[0.65rem] font-black uppercase tracking-widest text-ink">Slop Concentration</span>
          <span className="font-mono text-xs font-bold text-alert">{score}%</span>
        </div>
      )}
      <div className="relative h-4 w-full border-2 border-ink bg-black/5 overflow-hidden">
        <div
          className="h-full transition-all duration-1000 ease-out"
          style={{
            width: `${score}%`,
            background: `repeating-linear-gradient(45deg, var(--color-ink), var(--color-ink) 2px, transparent 2px, transparent 4px)`
          }}
        />
      </div>
      <div className="flex justify-between font-mono text-[0.6rem] font-bold opacity-30 uppercase tracking-tighter">
        <span>Organism</span>
        <span>Synthetic</span>
      </div>
    </div>
  )
}
