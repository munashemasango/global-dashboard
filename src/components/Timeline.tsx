import { useEffect, useRef } from 'react'
import { GitCompareArrows, Pause, Play, SkipBack, SkipForward } from 'lucide-react'

interface TimelineProps {
  year: number
  compareYear: number
  compareEnabled: boolean
  playing: boolean
  onYearChange: (year: number) => void
  onCompareYearChange: (year: number) => void
  onCompareToggle: () => void
  onPlayToggle: () => void
  startYear: number
  endYear: number
}

export function Timeline({
  year,
  compareYear,
  compareEnabled,
  playing,
  onYearChange,
  onCompareYearChange,
  onCompareToggle,
  onPlayToggle,
  startYear,
  endYear,
}: TimelineProps) {
  const yearRef = useRef(year)
  yearRef.current = year

  useEffect(() => {
    if (!playing) return
    const timer = window.setInterval(() => {
      onYearChange(yearRef.current >= endYear ? startYear : yearRef.current + 1)
    }, 1100)
    return () => window.clearInterval(timer)
  }, [endYear, onYearChange, playing, startYear])

  const changeBy = (amount: number) =>
    onYearChange(Math.min(endYear, Math.max(startYear, year + amount)))

  return (
    <footer className="timeline-shell">
      <div className="timeline-topline">
        <div className="timeline-date">
          <span className="eyebrow">HISTORICAL SERIES</span>
          <strong>{year}</strong>
          {compareEnabled && <span className="compare-tag">VS {compareYear}</span>}
        </div>
        <div className="timeline-controls">
          <button className="icon-button" title="Previous year" onClick={() => changeBy(-1)}>
            <SkipBack size={14} />
          </button>
          <button className="play-button" onClick={onPlayToggle}>
            {playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
            {playing ? 'PAUSE' : 'PLAY'}
          </button>
          <button className="icon-button" title="Next year" onClick={() => changeBy(1)}>
            <SkipForward size={14} />
          </button>
          <span className="control-divider" />
          <button
            className={`compare-button ${compareEnabled ? 'is-active' : ''}`}
            onClick={onCompareToggle}
            aria-pressed={compareEnabled}
          >
            <GitCompareArrows size={14} />
            COMPARE
          </button>
        </div>
      </div>
      <div className="range-row">
        <span className="range-bound">{startYear}</span>
        <input
          aria-label="Selected year"
          className="year-range"
          type="range"
          min={startYear}
          max={endYear}
          value={year}
          onChange={(event) => onYearChange(Number(event.target.value))}
          style={{ '--range-progress': `${((year - startYear) / (endYear - startYear)) * 100}%` } as React.CSSProperties}
        />
        <span className="range-bound">{endYear}</span>
      </div>
      {compareEnabled && (
        <div className="compare-range">
          <span className="compare-range-label">BASELINE</span>
          <input
            aria-label="Comparison year"
            className="year-range year-range-compare"
            type="range"
            min={startYear}
            max={endYear}
            value={compareYear}
            onChange={(event) => onCompareYearChange(Number(event.target.value))}
            style={{ '--range-progress': `${((compareYear - startYear) / (endYear - startYear)) * 100}%` } as React.CSSProperties}
          />
          <span className="compare-range-year">{compareYear}</span>
        </div>
      )}
    </footer>
  )
}
