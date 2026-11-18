import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { registerXgHttp } from '../src/xg/http.ts'
import { XgService } from '../src/xg/service.ts'
import { XgStore } from '../src/xg/store.ts'

type Handler = (req: unknown, res: unknown) => Promise<void>
function serve() {
  let handler: Handler = async () => {}
  const db = new DatabaseSync(':memory:')
  const store = new XgStore(db)
  const service = new XgService({ store, gateway: { dispatch: () => { throw new Error('no executor') }, retry: () => {}, stop: () => {} },
    tickets: { get: () => undefined } })
  const ctx = { webServer: { host: '127.0.0.1', port: 3082, register: (route: { handler: Handler }) => { handler = route.handler; return () => {} } } }
  registerXgHttp(ctx as never, { service, store })
  return async (method: string, path: string, body?: unknown, headers: Record<string, string | undefined> = {}) => {
    let status = 0, text = ''
    const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
    const sent = Object.fromEntries(Object.entries({ host: '127.0.0.1:3082', 'x-orchestrator-request': '1', ...headers })
      .filter(([, value]) => value !== undefined))
    const req = { method, url: `/xg/api/${path}`, headers: sent, async *[Symbol.asyncIterator]() { yield* chunks } }
    await handler(req, { writeHead: (code: number) => { status = code }, end: (data: string) => { text = data } })
    return { status, body: JSON.parse(text) as Record<string, unknown> }
  }
}

it('serves the xg panel API on the loopback same-origin contract', async () => {
  const call = serve()
  expect(await call('GET', 'overview')).toMatchObject({ status: 200, body: { projects: 0, inbox: 0, memoryPending: 0 } })
  const project = await call('POST', 'projects', { shortCode: 'BIL', name: '账单' })
  expect(project).toMatchObject({ status: 200, body: { shortCode: 'BIL', name: '账单' } })
  const projectId = String((project.body as { id: string }).id)
  expect(await call('GET', `projects/${projectId}/settings`)).toMatchObject({ status: 200, body: {
    settings: { workerProvider: null, workerModel: null, autoDispatch: false, defaultPriority: null } } })
  expect(await call('POST', `projects/${projectId}/settings`, { rootPath: 'G:/Projects/demo', sensitivity: '机密',
    workerModel: { provider: 'opencode-go', model: 'deepseek-v4.1-flash', reasoningEffort: 'max' }, autoDispatch: true,
    defaultPriority: 'P1' })).toMatchObject({ status: 200, body: { project: { rootPath: 'G:/Projects/demo', sensitivity: '机密' },
    settings: { workerProvider: 'opencode-go', workerModel: 'deepseek-v4.1-flash', workerEffort: 'max', autoDispatch: true,
      defaultPriority: 'P1' } } })
  expect(await call('POST', 'requirements', { projectId, title: '登录', sourceNote: '人工' }))
    .toMatchObject({ status: 200, body: { title: '登录', status: '待确认' } })
  const requirementId = String(((await call('GET', 'requirements')).body as { items: { id: string }[] }).items[0]!.id)
  expect(await call('POST', `requirements/${requirementId}/confirm`)).toMatchObject({ status: 200, body: { status: '已确认' } })
  expect(await call('POST', `requirements/${requirementId}/split`, { tasks: [{ title: '实现', type: '开发', priority: 'P1' }] }))
    .toMatchObject({ status: 200, body: { requirement: { status: '已拆分' } } })
  expect(await call('GET', 'tasks')).toMatchObject({ status: 200, body: { total: 1 } })
  const taskId = String(((await call('GET', 'tasks')).body as { items: { id: string }[] }).items[0]!.id)
  expect(await call('POST', `tasks/${taskId}/spec`, { content: '登录超时 5s 重试', approve: true }))
    .toMatchObject({ status: 200, body: { status: '已批准', content: '登录超时 5s 重试' } })
  expect(await call('GET', 'projects')).toMatchObject({ status: 200, body: { total: 1 } })
  expect(await call('GET', 'reviews')).toMatchObject({ status: 200, body: { total: 0 } })
  expect(await call('POST', `tasks/${taskId}/delete`)).toMatchObject({ status: 200, body: { deletedAt: expect.any(String) } })
  expect(await call('GET', 'tasks')).toMatchObject({ status: 200, body: { total: 0 } })
})

it('rejects requests without the same-origin panel headers', async () => {
  const call = serve()
  expect(await call('GET', 'overview', undefined, { 'x-orchestrator-request': undefined }))
    .toEqual({ status: 403, body: { error: '需要同源管理请求' } })
  expect(await call('GET', 'overview', undefined, { host: 'evil.example:3082' }))
    .toEqual({ status: 403, body: { error: '需要同源管理请求' } })
  expect(await call('GET', 'unknown')).toMatchObject({ status: 404 })
})
