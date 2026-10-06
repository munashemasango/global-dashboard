import { useEffect, useMemo, useRef, useState } from 'react'
import { geoGraticule10, geoNaturalEarth1, geoPath } from 'd3-geo'
import { feature } from 'topojson-client'
import type { Feature, FeatureCollection, Geometry } from 'geojson'
import type { GeometryCollection, Topology } from 'topojson-specification'
import type { CountryRecord, ScoreKey } from '../types'
import worldAtlasUrl from 'world-atlas/countries-50m.json?url'
import { scoreColor, scoreLabel } from '../lib/score'

interface WorldMapProps {
  countries: CountryRecord[]
  year: number
  layer: ScoreKey
  selectedId: string | null
  onSelect: (country: CountryRecord) => void
  compact?: boolean
}

interface CountryFeatureProperties {
  name?: string
}

interface MapSize {
  width: number
  height: number
}

interface RenderedFeature {
  key: string
  name: string
  path: string
  country: CountryRecord | undefined
}

export function WorldMap({
  countries,
  year,
  layer,
  selectedId,
  onSelect,
  compact = false,
}: WorldMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<MapSize>({ width: 0, height: 0 })
  const [features, setFeatures] = useState<FeatureCollection<Geometry, CountryFeatureProperties> | null>(null)
  const [boundaryError, setBoundaryError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetch(worldAtlasUrl, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Country boundary request failed (${response.status}).`)
        return response.json() as Promise<Topology<{ countries: GeometryCollection }>>
      })
      .then((topology) => {
        setFeatures(
          feature(topology, topology.objects.countries) as FeatureCollection<
            Geometry,
            CountryFeatureProperties
          >,
        )
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setBoundaryError(error instanceof Error ? error.message : 'Unable to load country boundaries.')
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const element = containerRef.current
    if (!element) return

    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const width = Math.round(entry.contentRect.width)
      const height = Math.round(entry.contentRect.height)
      setSize((current) =>
        current.width === width && current.height === height ? current : { width, height },
      )
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const countriesByNumericId = useMemo(
    () =>
      new Map(
        countries
          .filter((country) => country.numericId)
          .map((country) => [country.numericId!.padStart(3, '0'), country]),
      ),
    [countries],
  )

  const projection = useMemo(() => {
    if (!features || size.width < 1 || size.height < 1) return null
    return geoNaturalEarth1().fitExtent(
      [
        [12, 10],
        [size.width - 12, size.height - 10],
      ],
      features,
    )
  }, [features, size.height, size.width])

  const pathGenerator = useMemo(() => (projection ? geoPath(projection) : null), [projection])
  const graticulePath = useMemo(
    () => (pathGenerator ? pathGenerator(geoGraticule10()) : null),
    [pathGenerator],
  )
  const renderedFeatures = useMemo<RenderedFeature[]>(() => {
    if (!features || !pathGenerator) return []
    return features.features.flatMap((geoFeature: Feature<Geometry, CountryFeatureProperties>, index) => {
      const path = pathGenerator(geoFeature)
      if (!path) return []
      const id = geoFeature.id
      const country =
        id == null
          ? undefined
          : countriesByNumericId.get(String(id).padStart(3, '0'))
      return [
        {
          key: `${String(id ?? 'no-id')}:${geoFeature.properties?.name ?? 'unnamed'}:${index}`,
          name: country?.name ?? geoFeature.properties?.name ?? 'Unknown territory',
          path,
          country,
        },
      ]
    })
  }, [countriesByNumericId, features, pathGenerator])

  return (
    <div className={`map-frame ${compact ? 'map-frame-compact' : ''}`} ref={containerRef}>
      {size.width > 0 && size.height > 0 && (
        <svg
          aria-label={`World country vitality map, ${year}, ${layer}`}
          className="world-map-svg"
          height={size.height}
          role="group"
          viewBox={`0 0 ${size.width} ${size.height}`}
          width={size.width}
        >
          {graticulePath && <path className="map-graticule" d={graticulePath} aria-hidden="true" />}
          {renderedFeatures.map(({ key, name, path, country }) => {
            const record = country?.years[String(year)]
            const score = record?.scores[layer] ?? null
            return (
              <path
                aria-label={country ? `${name}, score ${scoreLabel(score)} out of 100` : name}
                aria-pressed={country ? country.id === selectedId : undefined}
                className={`country-shape ${country?.id === selectedId ? 'country-shape-selected' : ''}`}
                d={path}
                fill={scoreColor(score)}
                fillOpacity={score == null ? 0.42 : 0.82}
                key={key}
                onClick={country ? () => onSelect(country) : undefined}
                onKeyDown={country ? (event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onSelect(country)
                  }
                } : undefined}
                role={country ? 'button' : undefined}
                tabIndex={country ? 0 : undefined}
              >
                <title>
                  {name} · {score == null ? 'NO DATA' : `${scoreLabel(score)} / 100`}
                </title>
              </path>
            )
          })}
        </svg>
      )}
      {(boundaryError || !features || countries.length === 0) && (
        <div className="map-empty-state">
          <span className={`status-dot ${boundaryError ? 'status-dot-amber' : 'status-dot-cyan'}`} />
          <span title={boundaryError ?? undefined}>
            {boundaryError ? 'MAP DATA UNAVAILABLE' : !features ? 'LOADING COUNTRY BOUNDARIES' : 'WAITING FOR WORLD BANK DATA'}
          </span>
        </div>
      )}
      <div className="map-coordinates">WORLD / ADMIN-0</div>
    </div>
  )
}
