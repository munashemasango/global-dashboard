import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  ExternalLink,
  Globe2,
  Info,
  Layers3,
  MapPinned,
  Radio,
  Search,
  X,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { WorldMap } from './components/WorldMap'
import { Timeline } from './components/Timeline'
import { getTone, LAYERS, scoreColor, scoreLabel } from './lib/score'
import type { CountryRecord, IndicatorKey, ScoreKey, VitalityDataset } from './types'

const INDICATOR_LABELS: Record<IndicatorKey, string> = {
  gdpPerCapitaPpp: 'GDP / CAPITA, PPP',
  unemployment: 'UNEMPLOYMENT',
  lifeExpectancy: 'LIFE EXPECTANCY',
  literacyRate: 'ADULT LITERACY',
  electricityAccess: 'ELECTRICITY ACCESS',
  internetUsers: 'INTERNET USERS',
  forestArea: 'FOREST AREA',
  co2PerCapita: 'CO₂ / CAPITA',
}

const INDICATOR_FORMATTERS: Record<IndicatorKey, (value: number) => string> = {
  gdpPerCapitaPpp: (value) => `$${Math.round(value).toLocaleString('en-US')}`,
  unemployment: (value) => `${value.toFixed(1)}%`,
  lifeExpectancy: (value) => `${value.toFixed(1)} yr`,
  literacyRate: (value) => `${value.toFixed(1)}%`,
  electricityAccess: (value) => `${value.toFixed(1)}%`,
  internetUsers: (value) => `${value.toFixed(1)}%`,
  forestArea: (value) => `${value.toFixed(1)}%`,
  co2PerCapita: (value) => `${value.toFixed(1)} t`,
}

const PILLAR_KEYS: ScoreKey[] = ['economic', 'humanDevelopment', 'infrastructure', 'environment']

function readYear(country: CountryRecord | null, year: number) {
  return country?.years[String(year)] ?? null
}

function mean(values: (number | null | undefined)[]) {
  const usable = values.filter((value): value is number => value != null && Number.isFinite(value))
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null
}

function dateLabel(isoDate: string | undefined) {
  if (!isoDate) return 'DATASET NOT GENERATED'
  const date = new Date(isoDate)
  if (Number.isNaN(date.getTime())) return 'WORLD BANK WDI'
  return `BATCH ${date.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }).toUpperCase()}`
}

function MetricCard({
  label,
  value,
  note,
  icon,
  tone = 'amber',
}: {
  label: string
  value: string
  note: string
  icon: React.ReactNode
  tone?: 'amber' | 'cyan' | 'green'
}) {
  return (
    <article className="metric-card">
      <div className="metric-card-head">
        <span className="eyebrow">{label}</span>
        <span className={`metric-icon metric-icon-${tone}`}>{icon}</span>
      </div>
      <strong className="metric-value">{value}</strong>
      <span className="metric-note">{note}</span>
    </article>
  )
}

function EmptyDataset({ error }: { error: string }) {
  return (
    <div className="empty-dataset">
      <div className="empty-icon"><AlertCircle size={22} /></div>
      <div>
        <strong>WORLD BANK DATA UNAVAILABLE</strong>
        <p>
          {error} Run <code>python -m pipeline.etl</code> from the project root to fetch WDI
          observations and create <code>public/data/global_vitality_data.json</code>.
        </p>
      </div>
    </div>
  )
}

function DetailDrawer({
  country,
  year,
  compareYear,
  compareEnabled,
  layer,
}: {
  country: CountryRecord | null
  year: number
  compareYear: number
  compareEnabled: boolean
  layer: ScoreKey
}) {
  if (!country) {
    return (
      <aside className="detail-drawer drawer-empty">
        <div className="drawer-empty-icon"><MapPinned size={22} /></div>
        <span className="eyebrow">COUNTRY PROFILE</span>
        <h2>Select a country</h2>
        <p>Click any mapped country to inspect its vitality profile and historical signals.</p>
        <div className="drawer-instruction"><span className="status-dot status-dot-cyan" /> MAP INTERACTION ENABLED</div>
      </aside>
    )
  }

  const record = readYear(country, year)
  const compareRecord = readYear(country, compareYear)
  const score = record?.scores[layer] ?? null
  const compareScore = compareRecord?.scores[layer] ?? null
  const delta = score != null && compareScore != null ? score - compareScore : null
  const radarData = PILLAR_KEYS.map((key) => ({
    pillar: LAYERS.find((item) => item.key === key)?.short ?? key,
    score: record?.scores[key] ?? null,
    fullMark: 100,
  }))
  const trendData = Object.entries(country.years)
    .map(([yearKey, item]) => ({
      year: Number(yearKey),
      score: item.scores[layer],
    }))
    .sort((left, right) => left.year - right.year)

  return (
    <aside className="detail-drawer">
      <div className="drawer-header">
        <div>
          <div className="eyebrow">NATIONAL PROFILE / {country.id}</div>
          <h2>{country.name}</h2>
        </div>
      </div>
      <div className="country-meta">
        <span>{country.region ?? 'REGION N/A'}</span>
        <span>{country.incomeLevel ?? 'INCOME N/A'}</span>
        {country.capitalCity && <span>CAPITAL · {country.capitalCity.toUpperCase()}</span>}
      </div>

      <section className="country-score-card">
        <div className="score-card-top">
          <div>
            <span className="eyebrow">{LAYERS.find((item) => item.key === layer)?.label.toUpperCase()}</span>
            <div className={`hero-score ${getTone(score)}`}>{score == null ? '—' : score.toFixed(1)}</div>
          </div>
          <div className="score-year">{year} SCORE</div>
        </div>
        <div className="score-meter"><span style={{ width: `${score ?? 0}%`, background: scoreColor(score) }} /></div>
        <div className="score-card-foot">
          <span>RELATIVE COUNTRY POSITION</span>
          {compareEnabled && (
            <span className={delta == null ? 'tone-muted' : delta >= 0 ? 'tone-good' : 'tone-risk'}>
              {delta == null ? 'NO COMPARISON DATA' : `${delta >= 0 ? '+' : ''}${delta.toFixed(1)} VS ${compareYear}`}
            </span>
          )}
        </div>
      </section>

      <section className="drawer-section">
        <div className="section-heading">
          <div><span className="eyebrow">PILLAR BREAKDOWN</span><h3>Vitality profile</h3></div>
          <span className="section-year">{year}</span>
        </div>
        <div className="radar-wrap">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={radarData} outerRadius="72%">
              <PolarGrid stroke="#29333c" />
              <PolarAngleAxis dataKey="pillar" tick={{ fill: '#aeb7bf', fontSize: 9, fontFamily: 'var(--font-mono)' }} />
              <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} axisLine={false} />
              <Radar dataKey="score" stroke="#f3b43e" fill="#f3b43e" fillOpacity={0.18} strokeWidth={1.8} connectNulls={false} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="drawer-section trend-section">
        <div className="section-heading">
          <div><span className="eyebrow">HISTORICAL SERIES</span><h3>{LAYERS.find((item) => item.key === layer)?.short} trajectory</h3></div>
          <Activity size={15} className="icon-muted" />
        </div>
        <div className="trend-wrap">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trendData} margin={{ top: 8, right: 2, bottom: 0, left: -24 }}>
              <defs>
                <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#37b5c5" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="#37b5c5" stopOpacity={0.01} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#252f38" strokeDasharray="3 4" vertical={false} />
              <XAxis dataKey="year" tick={{ fill: '#707b85', fontSize: 9 }} tickLine={false} axisLine={false} minTickGap={26} />
              <YAxis domain={[0, 100]} tick={{ fill: '#707b85', fontSize: 9 }} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{ background: '#10171e', border: '1px solid #303b45', borderRadius: 4, fontSize: 11 }}
                labelStyle={{ color: '#98a4ae' }}
                formatter={(value) => [value == null ? 'N/A' : Number(value).toFixed(1), 'Score']}
              />
              {compareEnabled && <ReferenceLine x={compareYear} stroke="#f3b43e" strokeDasharray="3 4" />}
              <Area type="monotone" dataKey="score" stroke="#42bac8" strokeWidth={1.8} fill="url(#trend-fill)" connectNulls={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="drawer-section indicator-section">
        <div className="section-heading">
          <div><span className="eyebrow">SOURCE INDICATORS</span><h3>WDI observations</h3></div>
          <span className="section-year">{year}</span>
        </div>
        <div className="indicator-list">
          {(Object.keys(INDICATOR_LABELS) as IndicatorKey[]).map((key) => {
            const value = record?.values[key]
            const status = record?.status[key] ?? 'missing'
            const sourceYears = record?.sourceYears[key] ?? []
            return (
              <div className="indicator-row" key={key}>
                <div>
                  <span>{INDICATOR_LABELS[key]}</span>
                  {status === 'interpolated' && <small title={`Interpolated between ${sourceYears.join(' and ')}`}>INT</small>}
                  {status === 'forwardFilled' && <small title={`Carried forward from ${sourceYears[0] ?? 'unknown year'}`}>CARRY</small>}
                </div>
                <strong>{value == null ? '—' : INDICATOR_FORMATTERS[key](value)}</strong>
              </div>
            )
          })}
        </div>
        {record && (
          <div className="coverage-note">
            <Info size={12} />
            INDICATORS {record.completeness.indicatorCoverage?.toFixed(0) ?? '—'}% ·
            PILLARS {record.completeness.nvs?.toFixed(0) ?? '—'}% AVAILABLE
          </div>
        )}
      </section>
    </aside>
  )
}

function App() {
  const [dataset, setDataset] = useState<VitalityDataset | null>(null)
  const [dataError, setDataError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [year, setYear] = useState(2025)
  const [compareYear, setCompareYear] = useState(2000)
  const [compareEnabled, setCompareEnabled] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [layer, setLayer] = useState<ScoreKey>('nvs')
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [methodologyOpen, setMethodologyOpen] = useState(false)
  const startYear = dataset?.metadata.startYear ?? 2000
  const endYear = dataset?.metadata.endYear ?? 2025

  const changeYear = useCallback((nextYear: number) => {
    setYear(nextYear)
    setCompareYear((currentCompareYear) => {
      if (currentCompareYear !== nextYear) return currentCompareYear
      return nextYear >= endYear ? nextYear - 1 : nextYear + 1
    })
  }, [endYear])

  const changeCompareYear = useCallback((nextYear: number) => {
    setCompareYear(nextYear)
    setYear((currentYear) => {
      if (currentYear !== nextYear) return currentYear
      return nextYear <= startYear ? nextYear + 1 : nextYear - 1
    })
  }, [startYear])

  useEffect(() => {
    const controller = new AbortController()
    fetch('/data/global_vitality_data.json', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('Dataset file is missing. Run the Python ETL to generate it.')
        return response.json() as Promise<VitalityDataset>
      })
      .then((data) => {
        if (!data.metadata || !Array.isArray(data.countries)) throw new Error('Dataset JSON does not match the dashboard schema.')
        setDataset(data)
        setYear(data.metadata.endYear)
        setCompareYear(data.metadata.startYear)
        const topCountry = [...data.countries]
          .filter((country) => country.years[String(data.metadata.endYear)]?.scores.nvs != null)
          .sort(
            (left, right) =>
              (right.years[String(data.metadata.endYear)]?.scores.nvs ?? -1) -
              (left.years[String(data.metadata.endYear)]?.scores.nvs ?? -1),
          )[0] ?? data.countries[0]
        if (topCountry) setSelectedId(topCountry.id)
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setDataError(error instanceof Error ? error.message : 'Unable to load the World Bank dataset.')
      })
    return () => controller.abort()
  }, [])

  const countries = dataset?.countries ?? []
  const countryById = useMemo(() => new Map(countries.map((country) => [country.id, country])), [countries])
  const selectedCountry = selectedId ? countryById.get(selectedId) ?? null : null
  const layerDefinition = LAYERS.find((item) => item.key === layer) ?? LAYERS[0]

  const summary = useMemo(() => {
    const ranked = countries
      .map((country) => ({ country, score: country.years[String(year)]?.scores.nvs ?? null }))
      .filter((entry): entry is { country: CountryRecord; score: number } => entry.score != null)
      .sort((left, right) => right.score - left.score)
    const average = mean(ranked.map((entry) => entry.score))
    const interpolated = countries.reduce(
      (count, country) => count + (country.years[String(year)]?.imputed.length ?? 0),
      0,
    )
    return { ranked, average, interpolated }
  }, [countries, year])

  const filteredCountries = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) return []
    return countries
      .filter((country) => country.name.toLocaleLowerCase().includes(normalized) || country.id.toLocaleLowerCase() === normalized)
      .slice(0, 7)
  }, [countries, query])

  const handleSelect = useCallback((country: CountryRecord) => {
    setSelectedId(country.id)
  }, [])

  const selectedLayerTrend = useMemo(
    () =>
      summary.ranked
        .slice(0, 5)
        .map(({ country, score }) => ({ name: country.name, score })),
    [summary.ranked],
  )
  const mapPanel = (mapYear: number, isComparison: boolean) => (
    <section className="map-panel" key={`${isComparison ? 'compare' : 'primary'}-${mapYear}`}>
      <div className="map-panel-header">
        <div className="map-panel-title">
          <span className={`map-year-marker ${isComparison ? 'marker-compare' : ''}`} />
          <strong>{isComparison ? 'BASELINE' : 'CURRENT'} / {mapYear}</strong>
          <span className="map-panel-subtitle">{layerDefinition.short} · {layerDefinition.label.toUpperCase()}</span>
        </div>
        <span className="map-country-count">
          {countries.filter((country) => country.years[String(mapYear)]?.scores[layer] != null).length} WDI RECORDS
        </span>
      </div>
      <WorldMap
        countries={countries}
        year={mapYear}
        layer={layer}
        selectedId={selectedId}
        onSelect={handleSelect}
        compact={compareEnabled}
      />
      <div className="map-legend">
        <span className="eyebrow">SCORE</span>
        {[
          ['90+', '#14804a'],
          ['75–89', '#23925c'],
          ['60–74', '#d1b52c'],
          ['40–59', '#db872d'],
          ['20–39', '#c64f36'],
          ['0–19', '#821f2c'],
        ].map(([label, color]) => (
          <span className="legend-item" key={label}><i style={{ background: color }} />{label}</span>
        ))}
        <span className="legend-missing"><i />N/A</span>
      </div>
    </section>
  )

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark"><Globe2 size={19} strokeWidth={1.8} /></div>
          <div>
            <div className="brand-name">GLOBAL VITALITY <span>TERMINAL</span></div>
            <div className="brand-caption">NATIONAL INDICATORS / WORLD MONITOR</div>
          </div>
        </div>
        <div className="header-center">
          <span className="terminal-tag"><span className="status-dot status-dot-green" /> WORLD BANK / WDI</span>
          <span className="header-separator" />
          <span className="header-batch">{dateLabel(dataset?.metadata.generatedAt)}</span>
        </div>
        <div className="header-actions">
          <div className="search-wrap">
            <Search size={14} />
            <input
              aria-label="Search countries"
              placeholder="FIND COUNTRY"
              value={query}
              onFocus={() => setSearchOpen(true)}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setSearchOpen(false)
                if (event.key === 'Enter' && filteredCountries[0]) {
                  handleSelect(filteredCountries[0])
                  setSearchOpen(false)
                }
              }}
            />
            {searchOpen && query && filteredCountries.length > 0 && (
              <div className="search-results">
                {filteredCountries.map((country) => (
                  <button
                    key={country.id}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      handleSelect(country)
                      setQuery('')
                      setSearchOpen(false)
                    }}
                  >
                    <span>{country.name}</span><small>{country.id}</small>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className="methodology-button" onClick={() => setMethodologyOpen(true)}><Info size={14} /> METHODOLOGY</button>
        </div>
      </header>

      <div className="dashboard-content">
        <section className="instrument-header">
          <div className="page-title">
            <div className="eyebrow"><span className="terminal-glyph">01</span> GLOBAL MACRO / COUNTRY INTELLIGENCE</div>
            <h1>National <span>Vitality</span> Monitor</h1>
            <p>Comparative signals across prosperity, human development, infrastructure and environment.</p>
          </div>
          <div className="instrument-context">
            <div><span className="eyebrow">OBSERVATION YEAR</span><strong>{year}</strong></div>
            <span className="context-divider" />
            <div><span className="eyebrow">COVERAGE</span><strong>{summary.ranked.length || '—'} <small>COUNTRIES</small></strong></div>
            <span className="context-divider" />
            <div className="context-source"><span className="eyebrow">SOURCE</span><strong>WDI / WB</strong></div>
          </div>
        </section>

        <section className="metric-grid">
          <MetricCard
            label="GLOBAL VITALITY / AVG"
            value={summary.average == null ? '—' : summary.average.toFixed(1)}
            note={`NVS · ${summary.ranked.length ? `OF ${summary.ranked.length} SCORED` : 'NO OBSERVATIONS'}`}
            icon={<Activity size={15} />}
          />
          <MetricCard
            label="TOP RANKED"
            value={summary.ranked[0]?.country.id ?? '—'}
            note={summary.ranked[0]?.country.name.toUpperCase() ?? 'AWAITING DATA'}
            icon={<ArrowUpRight size={15} />}
            tone="green"
          />
          <MetricCard
            label="MEDIAN COUNTRY"
            value={summary.ranked.length ? scoreLabel(summary.ranked[Math.floor(summary.ranked.length / 2)].score) : '—'}
            note="NVS · CROSS-COUNTRY MEDIAN"
            icon={<BarChart3 size={15} />}
            tone="cyan"
          />
          <MetricCard
            label="IMPUTED OBSERVATIONS"
            value={summary.interpolated.toLocaleString('en-US')}
            note={`COUNTRY-INDICATORS · ${year}`}
            icon={<ArrowDownRight size={15} />}
          />
        </section>

        {dataError && <EmptyDataset error={dataError} />}

        <section className="layer-section">
          <div className="layer-section-title">
            <Layers3 size={14} />
            <span className="eyebrow">INDEX LAYERS</span>
            <span className="layer-divider" />
          </div>
          <div className="layer-switcher" role="tablist" aria-label="Map index layer">
            {LAYERS.map((option) => (
              <button
                aria-selected={layer === option.key}
                className={`layer-button ${layer === option.key ? 'is-active' : ''}`}
                key={option.key}
                onClick={() => setLayer(option.key)}
                role="tab"
              >
                <span>{option.short}</span>
                <small>{option.label}</small>
              </button>
            ))}
          </div>
        </section>

        <section className="main-grid">
          <div className="analysis-column">
            <div className="map-grid">{compareEnabled ? mapPanel(compareYear, true) : null}{mapPanel(year, false)}</div>
            <div className="bottom-analysis">
              <section className="data-panel ranking-panel">
                <div className="panel-heading">
                  <div><span className="eyebrow">COUNTRY LEADERS</span><h2>Top vitality signals</h2></div>
                  <span className="panel-live"><Radio size={12} /> {year} / NVS</span>
                </div>
                <div className="ranking-list">
                  {selectedLayerTrend.length ? selectedLayerTrend.map((entry, index) => (
                    <button className={`ranking-row ${selectedId === countries.find((country) => country.name === entry.name)?.id ? 'ranking-selected' : ''}`} key={entry.name} onClick={() => {
                      const match = countries.find((country) => country.name === entry.name)
                      if (match) handleSelect(match)
                    }}>
                      <span className="rank-number">{String(index + 1).padStart(2, '0')}</span>
                      <span className="rank-country">{entry.name}</span>
                      <span className="rank-bar"><i style={{ width: `${entry.score}%`, background: scoreColor(entry.score) }} /></span>
                      <strong>{entry.score.toFixed(1)}</strong>
                    </button>
                  )) : <div className="panel-empty">NO SCORED OBSERVATIONS FOR {year}</div>}
                </div>
              </section>
              <section className="data-panel signal-panel">
                <div className="panel-heading">
                  <div><span className="eyebrow">READ THE INDEX</span><h2>Methodology notes</h2></div>
                  <button className="text-link" onClick={() => setMethodologyOpen(true)}>DETAILS <ExternalLink size={11} /></button>
                </div>
                <div className="signal-copy">
                  <span className="signal-symbol">Σ</span>
                  <p>Four equally weighted pillars. Each indicator is min-max scaled against countries in the same year; unemployment and CO₂ are inverted.</p>
                </div>
                <div className="signal-foot"><span>RELATIVE, NOT ABSOLUTE</span><span>2000 — 2025</span></div>
              </section>
            </div>
          </div>

          <DetailDrawer
            country={selectedCountry}
            year={year}
            compareYear={compareYear}
            compareEnabled={compareEnabled}
            layer={layer}
          />
        </section>
      </div>

      <Timeline
        year={year}
        compareYear={compareYear}
        compareEnabled={compareEnabled}
        playing={playing}
        onYearChange={changeYear}
        onCompareYearChange={changeCompareYear}
        onCompareToggle={() => {
          setCompareEnabled((enabled) => !enabled)
          setPlaying(false)
        }}
        onPlayToggle={() => setPlaying((value) => !value)}
        startYear={startYear}
        endYear={endYear}
      />

      {methodologyOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setMethodologyOpen(false)
        }}>
          <section aria-labelledby="methodology-title" aria-modal="true" className="methodology-modal" role="dialog">
            <div className="modal-heading">
              <div><span className="eyebrow">DATA DESK / TECHNICAL NOTE</span><h2 id="methodology-title">Index methodology</h2></div>
              <button aria-label="Close methodology" className="icon-button" onClick={() => setMethodologyOpen(false)}><X size={15} /></button>
            </div>
            <div className="methodology-content">
              <div className="method-row"><span>COMPOSITE</span><p>National Vitality Score (NVS) is the equal-weighted mean of the four available pillar scores: economic, human development, infrastructure and environment.</p></div>
              <div className="method-row"><span>NORMALIZATION</span><p>Each indicator is min-max normalized across countries independently for each year. This is a relative cross-country position, not an absolute progress measure.</p></div>
              <div className="method-row"><span>DIRECTION</span><p>Unemployment and per-capita CO₂ are inverted. Forest cover is used as a limited environmental proxy; greater forest area alone does not measure biodiversity or ecosystem quality.</p></div>
              <div className="method-row"><span>MISSING VALUES</span><p>Interior gaps are interpolated and trailing gaps are carried forward. Imputed indicator values are marked EST. in country profiles; unavailable pillars are excluded and coverage is shown.</p></div>
              <div className="method-row"><span>INTERPRETATION</span><p>This dashboard is an exploratory proxy index, not an official World Bank or UN measure. GDP per capita is in current PPP dollars; WDI series can have reporting gaps and revisions.</p></div>
              <div className="method-row"><span>BOUNDARIES</span><p>The Natural Earth map matches 213 of 217 WDI records. Channel Islands, Gibraltar, Tuvalu and Kosovo have no matching feature in the packaged boundary dataset.</p></div>
              <div className="method-source"><span>SOURCE</span><a href="https://api.worldbank.org/v2/" target="_blank" rel="noreferrer">World Bank World Development Indicators API <ExternalLink size={12} /></a></div>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}

export default App
