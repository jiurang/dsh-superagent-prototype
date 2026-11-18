/** Minimal RFC822 email reading for the xg inbox: headers, transfer encodings, and HTML-only bodies. */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, type Dirent } from 'node:fs'
import { join } from 'node:path'
import type { XgStore } from './store.ts'

export interface EmailMessage {
  messageId: string
  from: string
  subject: string
  date: string
  text: string
}

export interface EmailCollectorOptions {
  inboxDir: string
  store: XgStore
  channel?: '邮箱'
  /** Poll interval in milliseconds; the collector does not scan before the first interval. */
  pollMs?: number
  onError?: (error: unknown) => void
}

export interface EmailScanResult {
  scanned: number
  added: number
  duplicates: number
}

interface Entity {
  headers: Record<string, string>
  body: string
}

interface Extracted {
  type: string
  text: string
  html: boolean
}

const normalizeNewlines = (value: string): string => value.replace(/\r\n?/g, '\n')
const byName = (left: Dirent, right: Dirent): number => left.name < right.name ? -1 : left.name > right.name ? 1 : 0
const isEml = (name: string): boolean => name.toLowerCase().endsWith('.eml')
const isMissing = (error: unknown): boolean => (error as { code?: unknown } | null | undefined)?.code === 'ENOENT'

/** Split a header block from its body at the first blank line; headerless input is all body. */
function splitEntity(raw: string): Entity {
  const lines = normalizeNewlines(raw).split('\n')
  const headerLines: string[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]!
    if (line === '') { index += 1; break }
    if (/^[ \t]/.test(line) || /^[^:]+:/.test(line)) { headerLines.push(line); index += 1; continue }
    break
  }
  return { headers: parseHeaders(headerLines), body: lines.slice(index).join('\n') }
}

function parseHeaders(lines: readonly string[]): Record<string, string> {
  const unfolded: string[] = []
  for (const line of lines) {
    if (/^[ \t]/.test(line) && unfolded.length) {
      const last = unfolded.length - 1
      unfolded[last] = `${unfolded[last] ?? ''} ${line.trim()}`
    } else {
      unfolded.push(line)
    }
  }
  const headers: Record<string, string> = {}
  for (const line of unfolded) {
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    const name = line.slice(0, colon).trim().toLowerCase()
    if (!(name in headers)) headers[name] = line.slice(colon + 1).trim()
  }
  return headers
}

/** Split parameters on semicolons outside quoted strings. */
function splitParameters(value: string): string[] {
  const parts: string[] = []
  let current = ''
  let quoted = false
  for (let index = 0; index < value.length; index++) {
    const char = value[index]!
    if (char === '"' && value[index - 1] !== '\\') quoted = !quoted
    if (char === ';' && !quoted) { parts.push(current); current = ''; continue }
    current += char
  }
  parts.push(current)
  return parts
}

function parseContentType(value: string | undefined): { type: string; params: Record<string, string> } {
  if (!value) return { type: 'text/plain', params: {} }
  const parts = splitParameters(value)
  const type = (parts.shift() ?? 'text/plain').trim().toLowerCase()
  const params: Record<string, string> = {}
  for (const part of parts) {
    const equals = part.indexOf('=')
    if (equals <= 0) continue
    const name = part.slice(0, equals).trim().toLowerCase()
    let raw = part.slice(equals + 1).trim()
    if (raw.startsWith('"')) {
      raw = raw.slice(1)
      if (raw.endsWith('"')) raw = raw.slice(0, -1)
      raw = raw.replace(/\\(.)/g, '$1')
    }
    params[name] = raw
  }
  return { type, params }
}

function decodeBytes(buffer: Buffer, charset: string | undefined): string {
  const name = (charset ?? 'utf-8').trim().toLowerCase().replace(/^"|"$/g, '')
  if (!name || name === 'utf-8' || name === 'utf8' || name === 'us-ascii' || name === 'ascii') return buffer.toString('utf8')
  try { return new TextDecoder(name).decode(buffer) } catch { return buffer.toString('utf8') }
}

function decodeQuotedPrintable(value: string, charset?: string): string {
  const text = normalizeNewlines(value)
  const bytes: number[] = []
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!
    if (char === '=') {
      if (text[index + 1] === '\n') { index += 1; continue }
      const hex = text.slice(index + 1, index + 3)
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) { bytes.push(Number.parseInt(hex, 16)); index += 2; continue }
      bytes.push(0x3d)
      continue
    }
    const code = char.codePointAt(0)!
    if (code <= 0x7f) bytes.push(code)
    else for (const byte of Buffer.from(char, 'utf8')) bytes.push(byte)
  }
  return decodeBytes(Buffer.from(bytes), charset)
}

function decodeTransfer(body: string, encoding: string | undefined, charset: string | undefined): string {
  switch ((encoding ?? '').trim().toLowerCase()) {
    case 'base64': return decodeBytes(Buffer.from(body.replace(/\s+/g, ''), 'base64'), charset)
    case 'quoted-printable': return decodeQuotedPrintable(body, charset)
    default: return body
  }
}

function decodeHeader(value: string): string {
  return value
    .replace(/(\?=)\s+(=\?)/g, '$1$2')
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_match: string, charset: string, encoding: string, data: string) => {
      if (encoding.toUpperCase() === 'B') return decodeBytes(Buffer.from(data, 'base64'), charset)
      return decodeQuotedPrintable(data.replace(/_/g, ' '), charset)
    })
}

function decodeEntities(value: string): string {
  const codePoint = (code: number): string => code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match: string, hex: string) => codePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match: string, decimal: string) => codePoint(Number.parseInt(decimal, 10)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
}

/** Turn an HTML-only body into readable text; scripts, styles, and comments never reach the inbox. */
function stripHtml(html: string): string {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|tr|h[1-6]|table|section|article|blockquote|pre|ul|ol)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
  return decodeEntities(text)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function splitMultipart(body: string, boundary: string): string[] {
  const marker = `--${boundary}`
  return body.split(marker).slice(1).flatMap(part => {
    if (part.startsWith('--')) return []
    return [part.startsWith('\n') ? part.slice(1) : part]
  })
}

function extract(entity: Entity): Extracted {
  const contentType = parseContentType(entity.headers['content-type'])
  if (contentType.type.startsWith('multipart/') && contentType.params.boundary) {
    const parts = splitMultipart(entity.body, contentType.params.boundary).map(part => extract(splitEntity(part)))
    const plain = parts.find(part => part.type === 'text/plain')
    if (plain) return plain
    const html = parts.find(part => part.type === 'text/html')
    if (html) return html
    return parts.find(part => part.text.trim().length > 0) ?? { type: 'text/plain', text: '', html: false }
  }
  const text = decodeTransfer(entity.body, entity.headers['content-transfer-encoding'], contentType.params.charset)
  return { type: contentType.type, text, html: contentType.type === 'text/html' }
}

/** Parse an `.eml` file into the fields the xg inbox stores, never touching the network. */
export function parseEml(raw: string): EmailMessage {
  const entity = splitEntity(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw)
  const headers = entity.headers
  const headerId = (headers['message-id'] ?? '').trim().replace(/^<+/, '').replace(/>+$/, '').trim()
  const extracted = extract(entity)
  return {
    messageId: headerId || createHash('sha256').update(raw).digest('hex'),
    from: decodeHeader(headers.from ?? '').trim(),
    subject: decodeHeader(headers.subject ?? '').trim(),
    date: (headers.date ?? '').trim(),
    text: normalizeNewlines(extracted.html ? stripHtml(extracted.text) : extracted.text).trim(),
  }
}

/**
 * Poll a mailbox directory of `.eml` files and copy each message into the xg inbox once.
 * Files stay in place; `(channel, externalRef)` makes a second scan a duplicate rather than a new item.
 */
export class EmailCollector {
  private readonly inboxDir: string
  private readonly store: XgStore
  private readonly channel: '邮箱'
  private readonly pollMs: number
  private readonly onError: (error: unknown) => void
  private timer: ReturnType<typeof setInterval> | null = null
  private active: Promise<EmailScanResult> | null = null

  constructor(options: EmailCollectorOptions) {
    this.inboxDir = options.inboxDir
    this.store = options.store
    this.channel = options.channel ?? '邮箱'
    this.pollMs = Math.max(1, options.pollMs ?? 60_000)
    this.onError = options.onError ?? (() => {})
  }

  /** Read every `.eml` file in the inbox and its immediate subdirectories; overlapping calls share one scan. */
  scanOnce(): Promise<EmailScanResult> {
    if (this.active) return this.active
    const run = this.scan().finally(() => { this.active = null })
    this.active = run
    return run
  }

  /** Start polling; a missing directory is not an error and simply yields no messages. */
  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => { void this.scanOnce().catch(error => this.onError(error)) }, this.pollMs)
    this.timer.unref?.()
  }

  stop(): void {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
  }

  private async scan(): Promise<EmailScanResult> {
    const files = this.files()
    let added = 0
    let duplicates = 0
    for (const file of files) {
      try {
        const message = parseEml(readFileSync(file, 'utf8'))
        const { created } = this.store.inbox.add({
          channel: this.channel,
          contact: message.from,
          rawContext: `${message.subject}\n\n${message.text}`,
          externalRef: message.messageId,
        })
        if (created) added += 1
        else duplicates += 1
      } catch (error) {
        this.onError(error)
      }
    }
    return { scanned: files.length, added, duplicates }
  }

  private files(): string[] {
    let entries: Dirent[]
    try {
      entries = readdirSync(this.inboxDir, { withFileTypes: true })
    } catch (error) {
      if (isMissing(error)) return []
      throw error
    }
    const files: string[] = []
    for (const entry of entries.sort(byName)) {
      const path = join(this.inboxDir, entry.name)
      if (entry.isFile()) {
        if (isEml(entry.name)) files.push(path)
        continue
      }
      if (!entry.isDirectory()) continue
      let children: Dirent[]
      try {
        children = readdirSync(path, { withFileTypes: true })
      } catch (error) {
        if (!isMissing(error)) this.onError(error)
        continue
      }
      for (const child of children.sort(byName)) if (child.isFile() && isEml(child.name)) files.push(join(path, child.name))
    }
    return files
  }
}
