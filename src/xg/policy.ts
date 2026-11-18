/** Sensitive-content scanning, redaction, and blocking for xg tool input and output. */
import type { Sensitivity } from './domain.ts'

export type XgFindingKind = 'api-key' | 'phone' | 'id-card' | 'internal-host' | 'customer'

export interface XgFinding {
  kind: XgFindingKind
  match: string
  redacted: string
}

export interface XgPolicyOptions {
  /** Customer names treated as sensitive; matched case-sensitively, longest name first. */
  customers?: string[]
  /** Lowest sensitivity at which findings block instead of being redacted. */
  blockSensitivity?: Sensitivity
}

export interface XgRedactResult {
  text: string
  findings: XgFinding[]
}

export interface XgGuardResult extends XgRedactResult {
  blocked: boolean
}

export interface XgAuditSummary {
  count: number
  /** Distinct kinds present, sorted, so an audit row stays stable. */
  kinds: XgFindingKind[]
}

interface Range {
  start: number
  end: number
}

interface Candidate extends Range {
  kind: XgFindingKind
  match: string
}

const SENSITIVITY_RANK: Readonly<Record<Sensitivity, number>> = { 公开: 0, 内部: 1, 机密: 2 }
const MAX_FIELD_DEPTH = 8

/** Replacement labels are protected, so redacting an already-redacted text changes nothing. */
const REDACTION_MARKER = /\[已脱敏:[^\]]*\]/g

const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d{2}|[1-9]?\\d)'
const PATTERNS: readonly { kind: XgFindingKind; pattern: RegExp }[] = [
  // `oc_sk_` comes first so its longer form wins over the generic `sk-` token.
  { kind: 'api-key', pattern: /(?<![A-Za-z0-9_-])(?:oc_sk_[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{8,}|AKIA[A-Z0-9]{8,})(?![A-Za-z0-9_-])/g },
  { kind: 'id-card', pattern: /(?<!\d)\d{17}[\dXx](?![\dXx])/g },
  { kind: 'phone', pattern: /(?<!\d)1[3-9]\d{9}(?!\d)/g },
  // 10/8 and 172.16-31 are private ranges; the lookarounds keep them out of longer hosts and IPs.
  { kind: 'internal-host', pattern: new RegExp(`(?<![\\d.])(?:10(?:\\.${OCTET}){3}|192\\.168(?:\\.${OCTET}){2}|172\\.(?:1[6-9]|2\\d|3[01])(?:\\.${OCTET}){2})(?::\\d{1,5})?(?![\\d.])`, 'g') },
]

const overlaps = (ranges: readonly Range[], start: number, end: number): boolean =>
  ranges.some(range => start < range.end && range.start < end)

const collect = (text: string, pattern: RegExp, kind: XgFindingKind): Candidate[] => {
  const found: Candidate[] = []
  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined || match[0] === '') continue
    found.push({ start: match.index, end: match.index + match[0].length, kind, match: match[0] })
  }
  return found
}

const label = (kind: XgFindingKind): string => `[已脱敏:${kind}]`
const findingOf = (candidate: Candidate): XgFinding => ({
  kind: candidate.kind, match: candidate.match, redacted: label(candidate.kind),
})
const applyRedaction = (text: string, candidates: readonly Candidate[]): string => {
  if (!candidates.length) return text
  const parts: string[] = []
  let cursor = 0
  for (const candidate of candidates) {
    parts.push(text.slice(cursor, candidate.start), label(candidate.kind))
    cursor = candidate.end
  }
  parts.push(text.slice(cursor))
  return parts.join('')
}
const isPlainObject = (value: object): boolean => {
  const prototype = Object.getPrototypeOf(value) as object | null
  return prototype === Object.prototype || prototype === null
}

/**
 * Scan and redact secrets and customer names in xg context.
 *
 * Findings are ordered by position. A redaction label is never rescanned, which makes `redact` idempotent.
 * `guard` returns the original text when it blocks, so callers that refuse to send content never hold a half-redacted leak.
 */
export class XgPolicy {
  private readonly customers: string[]
  private readonly blockSensitivity: Sensitivity

  constructor(options: XgPolicyOptions = {}) {
    this.customers = [...new Set((options.customers ?? []).map(name => name.trim()).filter(Boolean))]
      .sort((left, right) => right.length - left.length || (left < right ? -1 : left > right ? 1 : 0))
    this.blockSensitivity = options.blockSensitivity ?? '机密'
  }

  /** Detect every sensitive span in `text`, resolving overlaps by kind priority and, for customers, longest name first. */
  scan(text: string): XgFinding[] {
    return this.inspect(text).map(findingOf)
  }

  /** Replace each finding with `[已脱敏:<kind>]`; build the result from the original text, never from labels. */
  redact(text: string): XgRedactResult {
    const candidates = this.inspect(text)
    return { text: applyRedaction(text, candidates), findings: candidates.map(findingOf) }
  }

  /** Redact below the configured block threshold; block (and return the original) at or above it. */
  guard(text: string, sensitivity: Sensitivity): XgGuardResult {
    const candidates = this.inspect(text)
    const findings = candidates.map(findingOf)
    const blocked = findings.length > 0 && SENSITIVITY_RANK[sensitivity] >= SENSITIVITY_RANK[this.blockSensitivity]
    return blocked ? { text, findings, blocked } : { text: applyRedaction(text, candidates), findings, blocked }
  }

  /**
   * Redact string values recursively through arrays and plain objects, up to eight containers deep.
   * Throws instead of returning a partially guarded value when any string blocks.
   */
  guardFields<T extends Record<string, unknown>>(value: T, sensitivity: Sensitivity): T {
    return this.guardValue(value, sensitivity, 0, '') as T
  }

  private inspect(text: string): Candidate[] {
    if (!text) return []
    const protectedRanges: Range[] = []
    for (const match of text.matchAll(REDACTION_MARKER)) {
      if (match.index !== undefined) protectedRanges.push({ start: match.index, end: match.index + match[0].length })
    }
    const claimed: Range[] = [...protectedRanges]
    const candidates: Candidate[] = []
    const claim = (candidate: Candidate): void => {
      if (overlaps(claimed, candidate.start, candidate.end)) return
      claimed.push(candidate)
      candidates.push(candidate)
    }
    for (const { kind, pattern } of PATTERNS) {
      for (const candidate of collect(text, pattern, kind)) claim(candidate)
    }
    // Names are already longest first, so a broader customer name claims its span before a shorter one.
    for (const name of this.customers) {
      let from = 0
      while (from <= text.length - name.length) {
        const start = text.indexOf(name, from)
        if (start < 0) break
        claim({ start, end: start + name.length, kind: 'customer', match: name })
        from = start + name.length
      }
    }
    return candidates.sort((left, right) => left.start - right.start || left.end - right.end)
  }

  private guardValue(value: unknown, sensitivity: Sensitivity, depth: number, path: string): unknown {
    if (typeof value === 'string') {
      const result = this.guard(value, sensitivity)
      if (result.blocked) {
        const kinds = auditSummary(result.findings).kinds.join(', ')
        throw new Error(`字段 ${path || '根'} 包含敏感信息（${kinds}），已阻止`)
      }
      return result.text
    }
    if (Array.isArray(value)) {
      if (depth >= MAX_FIELD_DEPTH) return value
      return value.map((item, index) => this.guardValue(item, sensitivity, depth + 1, `${path}[${index}]`))
    }
    if (value && typeof value === 'object' && isPlainObject(value)) {
      if (depth >= MAX_FIELD_DEPTH) return value
      const guarded: Record<string, unknown> = {}
      for (const [key, item] of Object.entries(value)) {
        guarded[key] = this.guardValue(item, sensitivity, depth + 1, path ? `${path}.${key}` : key)
      }
      return guarded
    }
    return value
  }
}

/** Compact summary for audit rows: total findings and the distinct kinds, sorted. */
export function auditSummary(findings: readonly XgFinding[]): XgAuditSummary {
  return { count: findings.length, kinds: [...new Set(findings.map(finding => finding.kind))].sort() }
}
