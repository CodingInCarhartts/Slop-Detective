interface SlopBadgeProps {
  score: number
  showScore?: boolean
}

export function SlopBadge({ score }: SlopBadgeProps) {
  const getVerdict = (score: number) => {
    if (score > 80) return { text: "SYNTHETIC", color: "var(--color-alert)" }
    if (score > 40) return { text: "SUSPICIOUS", color: "#d97706" } // Orange-ish
    return { text: "ORGANIC", color: "var(--color-blue-ink)" }
  }

  const verdict = getVerdict(score)

  return (
    <div 
      className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-[stamp-slam_0.4s_cubic-bezier(0.175,0.885,0.32,1.275)_forwards] pointer-events-none"
      style={{
        color: verdict.color,
        borderColor: verdict.color,
      }}
    >
      <div className="stamp-border font-display font-black text-2xl tracking-tighter whitespace-nowrap bg-paper/20 backdrop-blur-[1px]">
        {verdict.text}
      </div>
    </div>
  )
}
