// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { XgTaskDetail, XgWorkbench } from '../src/xg/api-contract.ts'
import type { InboxItem, Proposal, Requirement, Task } from '../src/xg/domain.ts'
import { readViewState, updateViewState } from '../src/client/xg/v2/navigation.ts'

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean }
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const h = vi.hoisted(() => {
  const at = '2026-11-18T09:00:00.000Z'
  const project = {
    id: 'P1', shortCode: 'BIL', name: '账单', rootPath: null, sensitivity: '内部', status: '活跃',
    createdAt: at, updatedAt: at,
  } satisfies import('../src/xg/domain.ts').Project
  const requirement: Requirement = {
    id: 'R1', projectId: 'P1', seqNo: 1, sourceId: null, sourceNote: '客户群', title: '账单对账优化',
    description: '客户希望账单能自动对账。', status: '待确认', priority: 'P1', deletedAt: null,
    createdAt: at, updatedAt: at,
  }
  const task: Task = {
    id: 'T1', projectId: 'P1', requirementId: 'R1', seqNo: 1, title: '改接口', description: '补齐账单接口字段。',
    type: '开发', status: '评审', priority: 'P1', acceptance: '接口联调通过', currentAttemptId: 'T1-A1',
    autoDispatch: false, blockedFromStatus: null, acceptedBy: null, acceptedAt: null, completedAt: null,
    deletedAt: null, createdAt: at, updatedAt: at,
  }
  const inboxItem: InboxItem = {
    id: 'I1', projectId: 'P1', channel: '企微', contact: '王五', rawContext: '客户反馈账单金额不对，请尽快看看。',
    externalRef: null, status: '未处理', receivedAt: at, triagedAt: null, deletedAt: null,
  }
  const proposal: Proposal = {
    id: 'PR1', projectId: 'P1', kind: 'requirement.split', targetType: 'requirement', targetId: 'R1',
    baseRevision: null, title: '拆分「账单对账优化」', summary: '建议拆成接口改造任务',
    payload: { tasks: [{ title: '改接口', type: '开发', priority: 'P1' }] }, status: '待确认', createdBy: 'agent',
    createdAt: at, resolvedBy: null, resolvedAt: null, resolution: null,
  }
  const fixture: XgWorkbench = {
    overview: { projects: 1, tasks: { 就绪: 0, 进行中: 0, 评审: 1, 待验收: 0, 完成: 0, 阻塞: 0, 取消: 0 },
      active: [task], inbox: 1, memoryPending: 0, reviews: 0 },
    projects: [project], requirements: [requirement], tasks: [task], inbox: [inboxItem], memory: [],
    proposals: [proposal], reviews: [], audit: [],
  }
  const taskDetail: XgTaskDetail = {
    task, project, requirement,
    attempts: [{ id: 'T1-A1', taskId: 'T1', ticketId: null, assignmentId: null, workerSessionId: null, stage: '实现',
      status: '结束', lastReportAt: at, attention: null, tokenCost: null, runtimeVersion: null, createdAt: at, endedAt: at }],
    artifacts: [], triage: [], reviews: [], events: [], spec: null,
  }
  const xgGet = vi.fn(async (route: string) => route === '/tasks/:id' ? taskDetail : fixture)
  const xgPost = vi.fn(async () => ({}))
  const usePoll = vi.fn(() => ({ data: fixture, error: undefined, reload: async () => {} }))
  const openSession = vi.fn(async () => {})
  const usePanel = () => ({ t: (key: string) => key, call: vi.fn(), navigate: vi.fn(), back: vi.fn(), backLabel: '',
    openSession, notify: vi.fn(), restart: vi.fn() })
  const usePanelData = () => ({ state: undefined, error: undefined, reload: async () => {}, setup: undefined, running: 0,
    restarts: 0 })
  const SettingsPanel = () => null
  return { fixture, taskDetail, xgGet, xgPost, usePoll, usePanel, usePanelData, SettingsPanel, openSession }
})

vi.mock('../src/client/api.ts', () => ({ usePoll: h.usePoll }))
vi.mock('../src/client/xg/client.ts', () => ({ xgGet: h.xgGet, xgPost: h.xgPost }))
vi.mock('../src/client/provider.tsx', () => ({ usePanel: h.usePanel, usePanelData: h.usePanelData }))
vi.mock('../src/client/xg/v2/SettingsPanel.tsx', () => ({ SettingsPanel: h.SettingsPanel }))

import { Workbench } from '../src/client/xg/v2/Workbench.tsx'

Element.prototype.scrollTo = () => {}
Element.prototype.scrollIntoView = () => {}

let container: HTMLDivElement | undefined
let root: Root | undefined

async function flush() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}
async function render(view: 'today' | 'work' | 'inbox' | 'knowledge' | 'settings', onNavigate = vi.fn()) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => { root!.render(<Workbench view={view} deploymentForm={{} as never} onNavigate={onNavigate} />) })
  await flush()
  return { element: container, onNavigate }
}
const findButton = (scope: ParentNode, text: string) =>
  [...scope.querySelectorAll('button')].find(item => item.textContent?.trim() === text)
async function click(target: HTMLElement) {
  await act(async () => {
    target.click()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}
async function type(field: HTMLTextAreaElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!
    setter.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.xgGet.mockImplementation(async (route: string) => route === '/tasks/:id' ? h.taskDetail : h.fixture)
  h.xgPost.mockImplementation(async () => ({}))
  h.usePoll.mockImplementation(() => ({ data: h.fixture, error: undefined, reload: async () => {} }))
  updateViewState('work', { selection: null })
  updateViewState('inbox', { inboxId: null })
})

afterEach(async () => {
  if (root) await act(async () => { root!.unmount() })
  container?.remove()
  root = undefined
  container = undefined
  vi.restoreAllMocks()
})

it('shows today’s proposal diff and opens the work requirement selection', async () => {
  const { element, onNavigate } = await render('today')
  const attention = [...element.querySelectorAll('.wb-attn')]
  const proposalRow = attention.find(row => row.querySelector('.wb-type')?.textContent?.includes('Agent 提案'))
  expect(proposalRow).toBeDefined()
  expect(proposalRow!.querySelector('.wb-diff')?.textContent).toContain('改接口')
  expect(proposalRow!.querySelector('.wb-diffrow.add')?.textContent).toContain('开发 · P1')
  expect(attention.some(row => row.querySelector('.wb-type')?.textContent?.includes('需求'))).toBe(true)
  expect(attention.some(row => row.querySelector('.wb-type')?.textContent?.includes('收件 · 企微'))).toBe(true)
  expect(element.textContent).toContain('客户反馈账单金额不对，请尽快看看。')

  await click(findButton(proposalRow!, '查看')!)
  expect(onNavigate).toHaveBeenCalledWith('work')
  expect(readViewState('work').selection).toEqual({ kind: 'requirement', id: 'R1' })
})

it('submits a task review from the task document', async () => {
  updateViewState('work', { selection: { kind: 'task', id: 'T1' } })
  const { element } = await render('work')
  expect(element.textContent).toContain('评审中')
  expect(element.querySelector('.wb-reviewbox')).not.toBeNull()
  const comment = '先补边界用例'
  await type(element.querySelector<HTMLTextAreaElement>('.wb-reviewbox textarea')!, comment)
  await click(findButton(element.querySelector('.wb-reviewbox')!, '通过')!)
  expect(h.xgPost).toHaveBeenCalledWith('/tasks/:id/review',
    { decision: '通过', reviewer: '你', comments: comment }, { params: { id: 'T1' } })
})

it('deletes a task after confirmation and clears the work selection', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  updateViewState('work', { selection: { kind: 'task', id: 'T1' } })
  const { element } = await render('work')
  await click(findButton(element.querySelector('.wb-docfooter')!, '删除任务')!)
  expect(window.confirm).toHaveBeenCalled()
  expect(h.xgPost).toHaveBeenCalledWith('/tasks/:id/delete', undefined, { params: { id: 'T1' } })
  expect(readViewState('work').selection).toBeNull()
})

it('opens an inbox item and deletes it', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  const { element } = await render('inbox')
  const row = element.querySelector<HTMLElement>('.wb-inbox-row')!
  expect(row.textContent).toContain('王五')
  await click(row)
  expect(readViewState('inbox').inboxId).toBe('I1')
  expect(element.querySelector('.wb-triage')).not.toBeNull()
  const body = element.querySelector('.wb-inboxbody')!
  await click(findButton(body, '删除收件')!)
  expect(h.xgPost).toHaveBeenCalledWith('/inbox/:id/delete', undefined, { params: { id: 'I1' } })
  expect(readViewState('inbox').inboxId).toBeNull()
})

it('guards requirement deletion while it still has live tasks', async () => {
  updateViewState('work', { selection: { kind: 'requirement', id: 'R1' } })
  const { element } = await render('work')
  const remove = findButton(element.querySelector('.wb-docfooter')!, '删除需求')
  expect(remove).toBeDefined()
  expect(remove!.disabled).toBe(true)
  expect(element.querySelector('.wb-dangerhint')?.textContent).toContain('还有 1 个未取消的任务')
})
