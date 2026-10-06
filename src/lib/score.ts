import type { ScoreKey } from '../types'

export const LAYERS: { key: ScoreKey; short: string; label: string }[] = [
  { key: 'nvs', short: 'NVS', label: 'National Vitality' },
  { key: 'economic', short: 'EPI', label: 'Economic Prosperity' },
  { key: 'humanDevelopment', short: 'HDI', label: 'Human Development' },
  { key: 'infrastructure', short: 'IRI', label: 'Infrastructure Readiness' },
  { key: 'environment', short: 'ESI', label: 'Environmental Sustainability' },
  { key: 'connectivity', short: 'CTI', label: 'Connectivity & Technology' },
]

export function scoreColor(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '#29323b'
  if (value >= 90) return '#14804a'
  if (value >= 75) return '#23925c'
  if (value >= 60) return '#d1b52c'
  if (value >= 40) return '#db872d'
  if (value >= 20) return '#c64f36'
  return '#821f2c'
}

export function scoreLabel(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return Math.round(value).toString().padStart(2, '0')
}

export function getTone(value: number | null | undefined): string {
  if (value == null) return 'tone-muted'
  if (value >= 75) return 'tone-good'
  if (value >= 60) return 'tone-watch'
  if (value >= 40) return 'tone-caution'
  return 'tone-risk'
}
