import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { EmailCollector, parseEml } from '../src/xg/email.ts'
import { XgStore } from '../src/xg/store.ts'

let directory: string
let db: DatabaseSync
let store: XgStore
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'xg-email-'))
  db = new DatabaseSync(':memory:')
  store = new XgStore(db)
})
afterEach(() => {
  store.close()
  rmSync(directory, { recursive: true, force: true })
})

const plainEml = (id: string, body: string): string => [
  'From: 王五 <wangwu@example.com>',
  'Subject: 测试邮件',
  'Date: Tue, 17 Nov 2026 10:00:00 +0800',
  `Message-ID: <${id}>`,
  'Content-Type: text/plain; charset=UTF-8',
  'Content-Transfer-Encoding: 8bit',
  '',
  body,
].join('\r\n')

it('reads a plain UTF-8 message and normalizes CRLF', () => {
  const raw = [
    'From: 张三 <zhangsan@example.com>',
    'To: team@example.com',
    'Subject: 需求：登录页文案',
    'Date: Tue, 17 Nov 2026 09:00:00 +0800',
    'Message-ID: <plain-1@example.com>',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    '你好，请把登录页文案改为「立即登录」。',
    '谢谢！',
  ].join('\r\n')
  expect(parseEml(raw)).toEqual({
    messageId: 'plain-1@example.com',
    from: '张三 <zhangsan@example.com>',
    subject: '需求：登录页文案',
    date: 'Tue, 17 Nov 2026 09:00:00 +0800',
    text: '你好，请把登录页文案改为「立即登录」。\n谢谢！',
  })
})

it('decodes a wrapped base64 body', () => {
  const body = '这是一封 base64 编码的邮件。\n第二行。'
  const encoded = Buffer.from(body, 'utf8').toString('base64')
  const raw = [
    'From: a@example.com',
    'Subject: base64',
    'Message-ID: <b64@example.com>',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    encoded.slice(0, 16),
    encoded.slice(16),
  ].join('\r\n')
  expect(parseEml(raw).text).toBe(body)
})

it('decodes a quoted-printable body, including soft line breaks', () => {
  const raw = [
    'From: b@example.com',
    'Subject: quoted printable',
    'Message-ID: <qp@example.com>',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    '=E4=BD=A0=E5=A5=BD=EF=BC=8C=E8=AF=B7=E5=9C=A8=E5=91=A8=E4=BA=94=E5=89=8D=',
    '=E5=AE=8C=E6=88=90=E3=80=82',
  ].join('\r\n')
  expect(parseEml(raw).text).toBe('你好，请在周五前完成。')
})

it('unfolds folded headers and decodes encoded words', () => {
  const subject = Buffer.from('测试主题', 'utf8').toString('base64')
  const raw = [
    'From: 李四 <lisi@example.com>',
    'Subject: 需求：登录页文案调整',
    '\t并补充异常提示',
    'X-Note: first',
    ' second',
    `Message-ID: <folded@example.com>`,
    `X-Encoded: =?UTF-8?B?${subject}?=`,
    'Content-Type: text/plain; charset=UTF-8',
    '',
    '正文',
  ].join('\r\n')
  const message = parseEml(raw)
  expect(message.subject).toBe('需求：登录页文案调整 并补充异常提示')
  expect(message.from).toBe('李四 <lisi@example.com>')
  expect(message.messageId).toBe('folded@example.com')
})

it('strips HTML when the message has no text part', () => {
  const raw = [
    'From: c@example.com',
    'Subject: html',
    'Message-ID: <html@example.com>',
    'Content-Type: text/html; charset=UTF-8',
    '',
    '<html><body><p>请把&nbsp;<strong>导出</strong>&amp;打印按钮放在右侧。</p><script>alert("xss")</script></body></html>',
  ].join('\r\n')
  const text = parseEml(raw).text
  expect(text).toBe('请把 导出&打印按钮放在右侧。')
  expect(text).not.toContain('<')
  expect(text).not.toContain('alert')
})

it('prefers the text part of a multipart alternative', () => {
  const raw = [
    'From: d@example.com',
    'Subject: multipart',
    'Message-ID: <multi@example.com>',
    'Content-Type: multipart/alternative; boundary="alt-1"',
    '',
    '--alt-1',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    '纯文本版本',
    '--alt-1',
    'Content-Type: text/html; charset=UTF-8',
    '',
    '<p>HTML 版本</p>',
    '--alt-1--',
    '',
  ].join('\r\n')
  expect(parseEml(raw).text).toBe('纯文本版本')
})

it('hashes the raw message when Message-ID is absent', () => {
  const raw = ['From: e@example.com', 'Subject: no id', '', '正文'].join('\r\n')
  const message = parseEml(raw)
  expect(message.messageId).toMatch(/^[0-9a-f]{64}$/)
  expect(parseEml(raw).messageId).toBe(message.messageId)
})

it('adds each mail once, keeps the files, and reads one directory level down', async () => {
  const inbox = join(directory, 'inbox')
  mkdirSync(join(inbox, 'nested'), { recursive: true })
  const file = join(inbox, 'one.eml')
  writeFileSync(file, plainEml('one@example.com', '第一封邮件'))
  writeFileSync(join(inbox, 'nested', 'two.eml'), plainEml('two@example.com', '第二封邮件'))

  const collector = new EmailCollector({ inboxDir: inbox, store })
  expect(await collector.scanOnce()).toEqual({ scanned: 2, added: 2, duplicates: 0 })
  expect(await collector.scanOnce()).toEqual({ scanned: 2, added: 0, duplicates: 2 })

  const items = store.inbox.list().items
  expect(items).toHaveLength(2)
  expect(items.map(item => item.externalRef).sort()).toEqual(['one@example.com', 'two@example.com'])
  expect(items[0]).toMatchObject({ channel: '邮箱', contact: '王五 <wangwu@example.com>', status: '未处理' })
  expect(items.find(item => item.externalRef === 'one@example.com')?.rawContext).toBe('测试邮件\n\n第一封邮件')
  expect(existsSync(file)).toBe(true)
})

it('treats a missing inbox directory as empty', async () => {
  const collector = new EmailCollector({ inboxDir: join(directory, 'absent'), store })
  expect(await collector.scanOnce()).toEqual({ scanned: 0, added: 0, duplicates: 0 })
})

it('polls on the configured interval and stops cleanly', async () => {
  vi.useFakeTimers()
  try {
    const inbox = join(directory, 'poll')
    mkdirSync(inbox)
    writeFileSync(join(inbox, 'a.eml'), plainEml('poll@example.com', '轮询'))
    const collector = new EmailCollector({ inboxDir: inbox, store, pollMs: 1000 })
    collector.start()
    expect(store.inbox.list().total).toBe(0)
    await vi.advanceTimersByTimeAsync(1000)
    expect(store.inbox.list().total).toBe(1)
    collector.stop()
    await vi.advanceTimersByTimeAsync(5000)
    expect(store.inbox.list().total).toBe(1)
  } finally {
    vi.useRealTimers()
  }
})
