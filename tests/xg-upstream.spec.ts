import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** The only upstream files the xg layer may change; everything else belongs in src/xg or docs/xg. */
const ALLOWED = new Set([
  'README.md', 'package.json', 'docs/007-architecture.md', 'cordis.patch.yml',
  'src/core/engine.ts', 'src/core/evals.ts', 'src/index.ts', 'src/app/runtime.ts', 'src/app/sessions.ts', 'src/app/setup.ts',
  'src/deployment.ts', 'src/executor/dsh.ts', 'src/infra/environment.ts',
  'src/client/app.tsx', 'src/client/index.tsx', 'src/client/route.ts', 'src/client/locales.ts', 'src/client/settings-kit.tsx', 'src/client/settings.tsx',
  'src/client/client.css', 'src/client/overview.tsx', 'src/client/thread.tsx', 'src/client/ticket.tsx', 'src/client/trigger.tsx',
  'src/client/source.tsx', 'src/client/eval.tsx', 'src/client/execution.tsx', 'src/client/rows.tsx', 'src/client/marks.ts',
  'src/client/xg/panel.tsx', 'src/client/xg/xg.css',
  'tests/docs.spec.ts', 'tests/panel-panel.spec.tsx', 'tests/controls.spec.tsx', 'tests/model-surface.spec.ts',
  'tests/panel-overview.spec.tsx', 'tests/panel-settings.spec.tsx', 'tests/runtime.spec.ts', 'tests/fixtures/host.ts', 'tests/client.spec.tsx',
  'tests/panel-deployment.spec.tsx', 'tests/panel-eval.spec.tsx', 'tests/panel-execution.spec.tsx', 'tests/panel-prompts.spec.tsx',
  'tests/panel-source.spec.tsx', 'tests/panel-trigger.spec.tsx', 'tests/marks.spec.ts', 'tests/fixtures/panel.tsx', 'tests/fixtures/panel-server.ts',
  'tests/styles.spec.ts',
])
const git = (...args: string[]): string => {
  try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim() }
  catch { return '' }
}

it('A11: only the documented upstream files differ, and every one is in the rebase list', () => {
  // The check is meaningless outside a work tree; fail loudly instead of passing on an empty `git()` result.
  expect(git('rev-parse', '--is-inside-work-tree')).toBe('true')
  const changed = git('diff', '--name-only').split('\n').filter(Boolean).map(path => path.replaceAll('\\', '/'))
  const unexpected = changed.filter(path => !ALLOWED.has(path) && !path.startsWith('src/xg/') && !path.startsWith('src/client/xg/')
    && !path.startsWith('tests/xg-') && !path.startsWith('docs/xg/'))
  expect(unexpected).toEqual([])
  // Untracked xg paths are the business layer; anything else untracked is outside this change's contract.
  const status = git('status', '--porcelain').split('\n').filter(Boolean)
  const untracked = status.filter(line => line.startsWith('?? ')).map(line => line.slice(3).replaceAll('\\', '/'))
  const outside = untracked.filter(path => path !== 'xg.patch.yml' && !path.startsWith('src/xg/') && !path.startsWith('src/client/xg/')
    && !path.startsWith('tests/xg-') && !path.startsWith('docs/xg/') && !path.startsWith('docs/v1/'))
  expect(outside).toEqual([])
  const document = readFileSync(join(ROOT, 'docs/xg/upstream-changes.md'), 'utf8')
  const missing = changed.filter(path => ALLOWED.has(path) && !document.includes(path))
  expect(missing).toEqual([])
  // The business layer is never imported by the core: the only core change is the explicit host authorization.
  for (const file of ['src/core/engine.ts', 'src/core/evals.ts']) {
    expect(readFileSync(join(ROOT, file), 'utf8')).not.toContain('../xg/')
  }
})
