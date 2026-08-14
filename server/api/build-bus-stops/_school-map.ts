import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

export type SchoolMatch = {
  schoolId: number | null
  schoolName: string
}

export type SchoolMap = Record<string, SchoolMatch>

const SCHOOL_MAP_FILE = 'school-name-map.json'
const SCHOOL_LOCATIONS_FILE = 'School_Locations_2026-27.geojson'
const MIN_TOKEN_LEN = 2
const KEEP_SINGLE = new Set(['X'])

const NOISE = new Set([
  'ES', 'MS', 'HS', 'E', 'M', 'H',
  'ELEMENTARY', 'MIDDLE', 'HIGH', 'SCHOOL',
  'ACADEMY', 'ACAD', 'SCH',
  'PREPARATORY', 'PREP',
  'CENTER', 'LEARNING', 'COMMUNITY', 'INSTITUTE',
  'TECHNICAL', 'TRANSITION', 'VIRTUAL', 'FORMER',
  'ED', 'EDUCATION',
  'AND', 'OF', 'FOR', 'THE', 'AT', 'TO', 'A'
])

const ABBREVIATIONS: [RegExp, string][] = [
  [/\bINT'L\b/g, 'INTERNATIONAL'],
  [/\bINTL\b/g, 'INTERNATIONAL'],
  [/\bACDMY\b/g, 'ACADEMY'],
  [/\bACAD\b/g, 'ACADEMY'],
  [/\bPREP\b/g, 'PREPARATORY'],
  [/\bSCH\b/g, 'SCHOOL'],
  [/\bED\b/g, 'EDUCATION'],
  [/\bELEM\b/g, 'ELEMENTARY']
]

function clean(s: string): string {
  let out = (s || '').toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[.,']/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^A-Z0-9\s]/g, ' ')
  for (const [re, repl] of ABBREVIATIONS) {
    out = out.replace(re, repl)
  }
  return out.replace(/\s+/g, ' ').trim()
}

function tokens(s: string): string[] {
  return clean(s)
    .split(' ')
    .filter(t => t && (t.length >= MIN_TOKEN_LEN || KEEP_SINGLE.has(t)) && !NOISE.has(t))
}

export function loadSchoolMap(publicDataDir: string): SchoolMap {
  const file = resolve(publicDataDir, SCHOOL_MAP_FILE)
  if (!existsSync(file)) return {}
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as SchoolMap
  } catch {
    return {}
  }
}

export function saveSchoolMap(map: SchoolMap, publicDataDir: string) {
  const file = resolve(publicDataDir, SCHOOL_MAP_FILE)
  writeFileSync(file, JSON.stringify(map, null, 2))
}

export function loadSchoolLocations(publicDataDir: string) {
  const file = resolve(publicDataDir, SCHOOL_LOCATIONS_FILE)
  const raw = JSON.parse(readFileSync(file, 'utf-8')) as any
  return (raw.features || []).filter((f: any) => {
    const p = f?.properties
    return p && p.status === 'Active' && (p.schoolName || p.School)
  })
}

export function resolveSchoolName(raw: string, locations: any[]): SchoolMatch | null {
  if (!raw || !raw.trim()) return null
  const rawToks = tokens(raw)
  if (!rawToks.length) return { schoolId: null, schoolName: raw.trim() }

  let best: SchoolMatch | null = null
  let bestScore = -1

  for (const loc of locations) {
    const p = loc.properties || {}
    const schoolToks = tokens(p.School || '')
    const shortToks = tokens(p.shortName || '')
    const nameToks = tokens(p.schoolName || '')
    const allToks = [...new Set([...schoolToks, ...shortToks, ...nameToks])]

    let matched = 0
    let fieldScore = 0
    let firstBonus = 0

    // count raw tokens found anywhere, then weight the field it was found in
    for (const t of rawToks) {
      if (schoolToks.includes(t)) {
        matched++
        fieldScore += 10
      } else if (shortToks.includes(t)) {
        matched++
        fieldScore += 8
      } else if (nameToks.includes(t)) {
        matched++
        fieldScore += 3
      }
    }

    if (rawToks[0] && schoolToks[0] === rawToks[0]) firstBonus += 5
    if (rawToks[0] && shortToks[0] === rawToks[0]) firstBonus += 3
    if (rawToks[0] && nameToks[0] === rawToks[0]) firstBonus += 1

    // exact full matches are strongly preferred
    const exactSchool = schoolToks.join(' ') === rawToks.join(' ')
    const exactShort = shortToks.join(' ') === rawToks.join(' ')
    const exactName = nameToks.join(' ') === rawToks.join(' ')
    if (exactSchool) fieldScore += 80
    if (exactShort) fieldScore += 60
    if (exactName) fieldScore += 40

    // coverage of the raw name is the most important signal
    const score = matched * 100 + fieldScore + firstBonus

    if (score > bestScore) {
      bestScore = score
      best = {
        schoolId: p.meapCode ?? null,
        schoolName: p.schoolName || p.School || p.shortName || raw.trim()
      }
    }
  }

  if (bestScore < 20) return null
  return best
}
