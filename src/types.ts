export type ScoreKey =
  | 'nvs'
  | 'economic'
  | 'humanDevelopment'
  | 'infrastructure'
  | 'environment'
  | 'connectivity'

export type IndicatorKey =
  | 'gdpPerCapitaPpp'
  | 'unemployment'
  | 'lifeExpectancy'
  | 'literacyRate'
  | 'electricityAccess'
  | 'internetUsers'
  | 'forestArea'
  | 'co2PerCapita'

export interface YearRecord {
  values: Record<IndicatorKey, number | null>
  imputed: IndicatorKey[]
  status: Record<IndicatorKey, 'observed' | 'interpolated' | 'forwardFilled' | 'missing'>
  sourceYears: Record<IndicatorKey, number[]>
  scores: Record<ScoreKey, number | null>
  completeness: {
    indicators: number
    indicatorCoverage: number | null
    pillars: number
    nvs: number | null
  }
}

export interface CountryRecord {
  id: string
  numericId: string | null
  name: string
  region: string | null
  incomeLevel: string | null
  capitalCity: string | null
  years: Record<string, YearRecord>
}

export interface IndicatorMetadata {
  code: string
  name: string
  pillar: string
  direction: 'higher' | 'lower'
  unit: string
}

export interface VitalityDataset {
  metadata: {
    title: string
    schemaVersion: string
    source: string
    sourceUrl: string
    generatedAt: string
    startYear: number
    endYear: number
    normalization: string
    missingData: string
    scoring: string
    indicators: Record<IndicatorKey, IndicatorMetadata>
    pillarLabels: Record<ScoreKey, string>
    countryCount: number
  }
  countries: CountryRecord[]
}
