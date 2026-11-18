import { expect, it } from 'vitest'
import { XgPolicy, auditSummary } from '../src/xg/policy.ts'

it('finds every supported kind in one pass', () => {
  const policy = new XgPolicy({ customers: ['星河科技'] })
  const text = [
    '密钥 sk-abc123456789，另一个 oc_sk_live123456789，GitHub ghp_abcdefgh12345678，AWS AKIAIOSFODNN7EXAMPLE。',
    '手机 13812345678，身份证 11010519491231002X。',
    '主机 10.2.3.4:8080、192.168.1.20 和 172.20.0.9，客户星河科技。',
  ].join('\n')
  const findings = policy.scan(text)
  expect(findings.map(finding => finding.kind)).toEqual([
    'api-key', 'api-key', 'api-key', 'api-key', 'phone', 'id-card', 'internal-host', 'internal-host', 'internal-host', 'customer',
  ])
  expect(findings.map(finding => finding.match)).toEqual([
    'sk-abc123456789', 'oc_sk_live123456789', 'ghp_abcdefgh12345678', 'AKIAIOSFODNN7EXAMPLE',
    '13812345678', '11010519491231002X', '10.2.3.4:8080', '192.168.1.20', '172.20.0.9', '星河科技',
  ])
  expect(findings.every(finding => finding.redacted === `[已脱敏:${finding.kind}]`)).toBe(true)
})

it('does not mistake digits inside longer numbers for phone numbers', () => {
  const policy = new XgPolicy()
  expect(policy.scan('订单号 8613812345678，另一个编号 138123456789，预算 12000 元。')).toEqual([])
})

it('redacts only the matching spans and is idempotent', () => {
  const policy = new XgPolicy({ customers: ['星河科技'] })
  const original = '联系人 13812345678，客户星河科技，密钥 sk-abc12345678。'
  const first = policy.redact(original)
  expect(first.text).toBe('联系人 [已脱敏:phone]，客户[已脱敏:customer]，密钥 [已脱敏:api-key]。')
  expect(first.findings).toHaveLength(3)
  const second = policy.redact(first.text)
  expect(second.text).toBe(first.text)
  expect(second.findings).toEqual([])
})

it('prefers the longest configured customer name', () => {
  const policy = new XgPolicy({ customers: ['星河', '星河科技'] })
  expect(policy.scan('星河科技')).toEqual([{ kind: 'customer', match: '星河科技', redacted: '[已脱敏:customer]' }])
  expect(policy.redact('星河科技').text).toBe('[已脱敏:customer]')
})

it('blocks 机密 instead of leaking a partial redaction, and redacts 内部', () => {
  const policy = new XgPolicy()
  const secret = 'token sk-abcdefgh12345678 已泄露'
  const blocked = policy.guard(secret, '机密')
  expect(blocked.blocked).toBe(true)
  expect(blocked.text).toBe(secret)
  expect(blocked.findings.map(finding => finding.kind)).toEqual(['api-key'])
  expect(policy.guard(secret, '内部')).toEqual({
    text: 'token [已脱敏:api-key] 已泄露',
    findings: [{ kind: 'api-key', match: 'sk-abcdefgh12345678', redacted: '[已脱敏:api-key]' }],
    blocked: false,
  })
  expect(policy.guard(secret, '公开').blocked).toBe(false)
})

it('honors a lower block threshold', () => {
  const policy = new XgPolicy({ blockSensitivity: '内部' })
  expect(policy.guard('电话 13812345678', '内部').blocked).toBe(true)
  expect(policy.guard('电话 13812345678', '公开').blocked).toBe(false)
})

it('redacts nested string fields without changing the input object', () => {
  const policy = new XgPolicy({ customers: ['星河科技'] })
  const value = {
    name: '星河科技',
    nested: { phone: '13812345678', hosts: ['10.0.0.8:8080', 'ok'] },
    count: 2,
    enabled: true,
    missing: null,
  }
  expect(policy.guardFields(value, '内部')).toEqual({
    name: '[已脱敏:customer]',
    nested: { phone: '[已脱敏:phone]', hosts: ['[已脱敏:internal-host]', 'ok'] },
    count: 2,
    enabled: true,
    missing: null,
  })
  expect(value.nested.phone).toBe('13812345678')
})

it('throws when a guarded field blocks', () => {
  const policy = new XgPolicy()
  expect(() => policy.guardFields({ token: 'sk-abcdefgh12345678' }, '机密')).toThrow('已阻止')
  expect(policy.guardFields({ token: 'sk-abcdefgh12345678' }, '内部')).toEqual({ token: '[已脱敏:api-key]' })
})

it('summarizes findings by count and distinct kinds', () => {
  const policy = new XgPolicy({ customers: ['星河科技'] })
  const findings = policy.scan('星河科技 13812345678 与 13912345678')
  expect(auditSummary(findings)).toEqual({ count: 3, kinds: ['customer', 'phone'] })
  expect(auditSummary([])).toEqual({ count: 0, kinds: [] })
})
