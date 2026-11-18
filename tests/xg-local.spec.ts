import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Ticket } from '../src/core/index.ts'
import { Setup } from '../src/app/setup.ts'
import { writeEnvironment, workerBin, workerGitConfig } from '../src/infra/environment.ts'
import { SettingsSchema } from '../src/policy.ts'
import { localSourceKind } from '../src/xg/local.ts'
import { XgRuntime } from '../src/xg/runtime.ts'
import { XG_MIGRATIONS } from '../src/xg/schema.ts'
import { XgStore } from '../src/xg/store.ts'

let directory: string
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'xg-local-')) })
afterEach(() => { rmSync(directory, { recursive: true, force: true }) })

describe('local Source', () => {
  it('validates and trims its root path and listens without observing external messages', () => {
    expect(localSourceKind.schema.parse({ rootPath: '  /work/app  ' }).rootPath).toBe('/work/app')
    expect(localSourceKind.schema.parse({}).rootPath).toBe('')
    expect(localSourceKind.scope?.({ meta: {} }, { rootPath: '/work/app' })).toEqual({ listened: true, observed: false })
  })

  it('resolves a local deployment without GitHub when the local Source names a root path', async () => {
    const machine = { stateDir: join(directory, 'setup-state'), promptMaxChars: { get: () => 100_000 },
      admissionContextMaxPages: { get: () => 10 }, admissionContextTimeoutMs: { get: () => 15_000 } }
    const setup = new Setup({ context: {} as never, machine: machine as never, lifetime: new AbortController().signal,
      restart: () => {}, localRoot: () => join(directory, 'project') })
    const settings = SettingsSchema.parse({
      sources: { local: { enabled: true, config: { rootPath: join(directory, 'project') } } },
      executor: { blockedCommands: [] },
    })
    expect(await setup.run(settings)).toBe(true)
    expect(setup.configured()).toBe(true)
    expect(setup.deployment.repository).toBe('local')
    expect(setup.problem).toBeUndefined()
    setup.restore()
  })

  it('writes a local worker environment without GitHub credentials', async () => {
    const stateDir = join(directory, 'state')
    await writeEnvironment({ stateDir, repository: 'local', github: { cli: '', login: 'local', noreply: 'local@localhost' } }, [], { local: true })
    expect(readFileSync(join(workerBin(stateDir), 'gh'), 'utf8')).toContain('gh is unavailable in local mode')
    const gitconfig = readFileSync(workerGitConfig(stateDir), 'utf8')
    expect(gitconfig).not.toContain('credential.https://github.com')
    expect(gitconfig).not.toContain('auth git-credential')
    expect(gitconfig).toContain('useConfigOnly = true')
  })
})

describe('local workspace routing', () => {
  it('migrates a v1 database to the soft-delete column', () => {
    const db = new DatabaseSync(':memory:')
    db.exec(XG_MIGRATIONS[0]!)
    db.exec('CREATE TABLE xg_schema_version (version INTEGER NOT NULL)')
    db.prepare('INSERT INTO xg_schema_version VALUES (1)').run()
    const store = new XgStore(db)
    const project = store.projects.create({ shortCode: 'OLD', name: '旧库' })
    const requirement = store.requirements.create({ projectId: project.id, title: 'r', sourceNote: '人工' })
    const task = store.tasks.create({ projectId: project.id, requirementId: requirement.id, title: 't', type: '开发', priority: 'P1' })
    expect(store.tasks.get(task.id)?.deletedAt).toBeNull()
    expect(store.tasks.save({ ...task, deletedAt: '2026-01-01T00:00:00.000Z' }).deletedAt).toBe('2026-01-01T00:00:00.000Z')
    db.close()
  })

  it('uses the xg project root for a workbench Ticket and falls back to the local Source root', () => {
    const db = new DatabaseSync(':memory:')
    const store = new XgStore(db)
    const project = store.projects.create({ shortCode: 'LOC', name: '本地项目', rootPath: '/work/app' })
    const requirement = store.requirements.create({ projectId: project.id, title: 'r', sourceNote: '人工' })
    const task = store.tasks.create({ projectId: project.id, requirementId: requirement.id, title: 't', type: '开发', priority: 'P1' })
    const runtime = new XgRuntime({ db, engine: { authorizeTicket: () => { throw new Error('not used') }, retryTicket: () => {},
      stopTicket: () => {} }, tickets: { get: () => undefined }, defaultRoot: () => '/fallback' })
    const ticket = { id: 'T1', origin: { triggerId: `xg:task:${task.id}:1`, triggerIds: [] } } as unknown as Ticket
    expect(runtime.rootPathForTicket(ticket)).toBe('/work/app')
    expect(runtime.localWorkspace(ticket)).toBe(true)
    const noRoot = store.projects.update(project.id, { rootPath: null })
    expect(noRoot.rootPath).toBeNull()
    expect(runtime.rootPathForTicket(ticket)).toBe('/fallback')
    db.close()
  })
})
