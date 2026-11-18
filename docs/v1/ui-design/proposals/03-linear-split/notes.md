# 03 · Linear-style Split Workspace

**Prototype:** `index.html` · self-contained HTML/CSS/vanilla JS
**Target:** 1200 × 830 desktop, light theme, Chinese UI
**Mock data:** `DEMO`（演示项目 · 账单系统）, `NEW_CENTER_APP`（中心应用）
**Constraints:** no external fonts, images or libraries; all icons are inline SVG; no network calls.

---

## 1. Concept

The current panel is a page made of stacked sections: a mixed list, an inline split form inside one row, then a large “新建需求” form at the bottom. The hierarchy is present in the data model but not in the interface.

This proposal turns the workbench into a **persistent issue workspace**:

```text
Workspace shell
├─ 212px navigation rail        project context + 7 sections
└─ work area
   ├─ filter bar                status · priority · source · search · chips
   ├─ dense issue table         the spine of the workspace
   └─ 400px detail pane         the work surface
      ├─ requirement summary    status / priority / source / owner / time
      ├─ related tasks          task state visible without leaving the requirement
      ├─ inline split composer  split happens where the task list lives
      └─ task detail            attempts / evidence / review, never in a list
```

The project is the first-class context: the left switcher, the sidebar project list, and every query are scoped to one project. The requirement is the container: the table is how you navigate, the right pane is where you act. Attempts are treated as evidence of work, so they only appear inside a task detail.

The result should read like a professional issue tracker — high information density, quiet chrome, one accent, and actions close to their object — rather than a landing page with a form at the bottom.

---

## 2. Density principles

| Element | Specification |
|---|---|
| Frame | 1200 × 830, 1px border, 11px radius, centered on a warm gray canvas |
| Sidebar | 212px; 28px nav rows; project switcher 43px |
| Top bar | 56px: breadcrumb, page title/count/context, palette trigger, primary create |
| Requirement row | 40px; fixed header; independent list/detail scrolling |
| Detail pane | 400px; 34px context strip; 15px/21px title |
| Type scale | 9–16px; 12.5px table titles; 11.5px body; 9–10.5px metadata |
| Rules | 1px and 0.5px hairlines; no heavy card borders inside the list |
| Accent | `#5b5fd6` for selection, links, focus, and active filter state only |
| Primary action | near-black button; status colors are reserved for small dots/pills |

Specific choices:

1. **One line per row.** Titles truncate and expose the full text on hover. Prose, source quotes, and acceptance criteria live in the detail pane.
2. **Encode status three ways, cheaply.**
   - Requirement/task state: 6px dot + word (`待确认`, `进行中`, `阻塞`).
   - Priority: three tiny bars + `P0`…`P3`, colored by urgency.
   - Source: channel glyph + label (`企微`, `邮箱`, `电话`…).
   No filled multi-color badges in the table; color remains a signal, not decoration.
3. **The object owns its actions.** Requirement actions sit at the top of the requirement pane. Task actions sit above the task tabs. There is no page-bottom form.
4. **The list is a spine, not a dashboard.** The table header, chips, and footer stay put while the rows scroll. The right pane scrolls independently.
5. **Blocked work is visible from the list.** A requirement row shows a red `!` beside the task count when it contains a blocked task. The task list shows the red `阻塞` state directly.
6. **Strong selection, quiet hover.** Selected rows use a 2px inset accent bar + `--accent-soft`; hover is a neutral `#f8f8f6`. The eye can find the open object in one scan.
7. **Empty space is allowed.** A seven-row requirement list does not need invented cards to fill the pane; the free space keeps the density readable and the detail prominent.

---

## 3. Keyboard and interaction model

### 3.1 Global keys

| Key | Where | Action |
|---|---|---|
| `Ctrl/Cmd + K` | anywhere | open/close command palette |
| `C` | not typing | new requirement modal |
| `/` | not typing | focus the current page search; fall back to palette |
| `?` | not typing | keyboard shortcut sheet |
| `↑` / `↓` or `J` / `K` | requirement/task list | move selection; detail follows immediately |
| `Enter` | list with selection | focus the detail pane (not a destructive action) |
| `S` | requirement detail | open/close the inline split composer |
| `Esc` | contextual | close overlay → popover → split composer → detail |
| `D` | task `就绪` | dispatch |
| `R` | task `阻塞` | retry |
| `A` | task `待验收` | accept |
| `Ctrl/Cmd + Enter` | split / create / review form | submit |
| `Tab` | anywhere | native focus order; every action is reachable without a mouse |

The status bar shows the keys that are valid for the current page and task state, so the model is learnable without opening the shortcut sheet.

### 3.2 Focus and Escape ladder

- A global typing guard (`input`, `textarea`, `select`, `contenteditable`) prevents shortcuts from firing while writing.
- IME composition is guarded: search and palette do not re-render mid-composition, and `Enter` during composition is not treated as submit.
- `Esc` is an intentional ladder: overlay → project/filter popover → split composer → detail. It never deletes or changes data.
- Opening the split composer focuses its textarea; `Esc` discards the draft and restores the pane. `Ctrl/Cmd + Enter` submits.
- Modal focus starts at the title field (create), the cancel button (delete), or the palette input (Ctrl+K). Focus rings remain visible for keyboard users.

### 3.3 Filtering

- Requirement state is a segmented control: `活跃 / 待确认 / 已确认 / 已拆分 / 已关闭`, each with a count. `活跃` is the default scope, so closed work does not dilute the daily view.
- `筛选` opens a small priority/source popover; selected values remain visible as removable chips.
- Search has its own chip and does **not** light up the filter button (a prototype bug found and fixed during QA).
- Chips are the single source of truth for “why is this list short”. `重置` clears all filters back to `活跃`.
- Task filtering uses the same model with `活跃 / 就绪 / 进行中 / 评审 / 待验收 / 阻塞 / 完成`.

### 3.4 Requirement flow

1. Click a row → the right pane loads in place; the list does not navigate away.
2. `确认需求` is only shown for `待确认`; `拆任务` is always close at hand (except for closed requirements).
3. Status and priority are inline selects in the detail header; changing them updates the list immediately.
4. `关闭需求` / `重新打开` and `删除` live in the same action row.
5. Closing the pane (X or Esc) expands the list to full width. Selecting another row reopens it.

### 3.5 Split composer

- Each **line** becomes one task. Commas and semicolons inside a line do not split a title (same semantics as `taskTitlesFromInput`).
- Type, priority, and optional acceptance apply to the batch.
- A live preview says how many tasks will be created; a warning appears when lines look like a prose sentence accidentally split.
- On submit the requirement becomes `已拆分`, the task list expands, the table task count increments, and the task page receives the new `就绪` tasks.
- The composer is intentionally in the detail pane, directly under the related tasks; there is no second split form hidden inside a list row.

### 3.6 Task detail

- Inline metadata: requirement link, project, acceptance criteria, current attempt, updated time, type, internal id.
- Three tabs:
  - **运行记录**: attempt timeline with status, stage, session, report, error block, duration.
  - **证据**: typed artifact cards (log / command / code / document) with monospace content.
  - **评审**: submitted reviews and, for a `评审` task, an inline composer.
- Actions are state-dependent:
  - `就绪` → 派发
  - `阻塞` → 重试 / 取消
  - `评审` → 写评审 / 取消
  - `待验收` → 验收通过 / 取消
  - All active states → 删除
- A passed review moves the task to `待验收`; a returned review moves it back to `进行中`. The decision is appended to the global review log.
- Reviews for deleted tasks are retained as read-only “任务已删除 · 审计记录保留” rows rather than silently disappearing.

### 3.7 Create, delete, palette

- **Create** is a 500px modal, reachable from the top bar, `C`, the palette, or inbox triage. It captures project, title, description, priority, source, and source note. From inbox it pre-fills the message and removes the inbox item only after creation.
- **Delete** is a confirmation dialog with consequence copy: tasks leave the workbench; attempts, evidence, and audit records remain. The cancel button is focused by default.
- **Command palette** groups `操作 / 跳转 / 需求 / 任务`; typing filters record titles, ids, status, and type. Arrow keys move the selection, Enter executes, Esc closes. It is the single keyboard route to every page and object.

---

## 4. React mapping

### 4.1 Component tree

```text
App (src/client/app.tsx)
├─ PanelProvider                      existing provider + project context
└─ WorkspaceShell                     rail replaces the page-level SegmentedTabs;
   │                                  route semantics and TABS stay the same
   ├─ Sidebar
   │  ├─ Brand
   │  ├─ ProjectSwitcherPopover
   │  └─ NavItem[] (7 sections, counts)
   ├─ CommandPalette
   ├─ Topbar
   └─ main
      ├─ RequirementsWorkspace
      │  ├─ RequirementToolbar      status segments, filter popover, chips, search
      │  ├─ RequirementTable        windowed rows, fixed header/footer
      │  └─ RequirementPane
      │     ├─ RequirementFields    inline status/priority selects
      │     ├─ SourceQuote
      │     ├─ RelatedTaskList
      │     └─ SplitTaskComposer
      └─ TasksWorkspace
         ├─ TaskToolbar
         ├─ TaskTable
         └─ TaskPane
            ├─ TaskMeta
            ├─ AttemptTimeline
            ├─ EvidenceList
            └─ ReviewPane
```

Reusable primitives: `Button`, `Tag`, `Pill`, `Icon`, `Modal`, `Input` from `src/client/controls.tsx`; retain the `--dsw-alias-*` tokens and add `xg-` classes alongside `xg.css`.

### 4.2 State shape

```ts
type ReqFilter = { status: 'active' | 'pending' | 'confirmed' | 'split' | 'closed' | 'all';
                   priority: Priority | null; source: Source | null; q: string }
type TaskFilter = { status: 'active' | 'ready' | 'running' | 'review' | 'acceptance' | 'blocked' | 'done' | 'all';
                    q: string }

interface WorkspaceState {
  projectId: string                 // hoisted, not owned by each page
  requirementId?: string            // selected row / deep link
  taskId?: string
  reqFilter: ReqFilter
  taskFilter: TaskFilter
  split: { open: boolean; draft: string; type: TaskType; priority: Priority }
  palette: { open: boolean; query: string; index: number }
  taskTab: 'attempts' | 'evidence' | 'reviews'
  deleteTarget?: { type: 'requirement' | 'task'; id: string }
}
```

Use `useReducer` for the workspace shell (selection + overlays) and keep server data in the existing `useXg` / `useMutation` hooks. Keep the list selection optimistic; refresh the relevant query after a mutation.

### 4.3 Existing API mapping

| UI action | Existing endpoint |
|---|---|
| Load requirements | `GET /requirements?projectId=` |
| Create requirement | `POST /requirements` |
| Confirm requirement | `POST /requirements/:id/confirm` |
| Split tasks | `POST /requirements/:id/split` |
| Load project tasks | `GET /tasks?projectId=&status=` |
| Task detail | `GET /tasks/:id` → `XgTaskDetail` |
| Dispatch / retry / cancel / accept | `POST /tasks/:id/{dispatch,retry,cancel,accept}` |
| Spec / review | `POST /tasks/:id/spec`, `POST /tasks/:id/review` |
| Delete task | `POST /tasks/:id/delete` (soft-delete keeps audit) |
| Inbox triage | `POST /inbox/:id/triage` |
| Memory confirm/reject | `POST /memory/:id/{confirm,reject}` |

For the requirement pane, either add an optional `requirementId` query to `GET /tasks` or group the project task list client-side. The prototype derives related tasks from the project task array; a real implementation should fetch the detail only when the selection changes.

### 4.4 Route and deep linking

Extend the current `Route` union so `requirements` and `tasks` can carry an `id` and filter query:

```ts
| { page: 'requirements'; id?: string; query?: { status?: ReqStatusFilter; priority?: Priority; source?: Source; q?: string } }
| { page: 'tasks'; id?: string; query?: { status?: TaskStatusFilter; q?: string } }
```

Update `parseRoute`/`remember` in `src/client/route.ts`; keep the project in the URL/session location so switching projects is reversible. If full routing is too much for a first pass, keep selection in workspace state and persist `projectId` + filters in `sessionStorage` like the current route memory.

### 4.5 Keyboard and performance

- Register global shortcuts once in the shell; use an `isTyping` guard and skip `isComposing` events.
- Restore focus and scroll position after re-render (`requestAnimationFrame` or layout effect): the selected row should stay visible, the detail should reset to top only when the selected object changes.
- Window the requirement/task table for hundreds of rows. No third-party UI library is required; use a `ResizeObserver` + fixed row height (40px) window, or render 80 rows per page with “load more”.
- Debounce search (150–200ms) in React; the prototype re-renders synchronously and skips IME composition only.
- Fetch task detail only while `taskId` is open; show a skeleton in the pane. Keep attempts/artifacts/reviews keyed by task id to avoid stale details.
- After split, update the requirement and task list in place; do not navigate away. After accept/close, keep the next selection stable or close the pane deliberately.

### 4.6 Accessibility notes

- Use a real `<table>`/`role="grid"` or focusable row buttons with `aria-selected`; keep a visible focus ring (2px accent).
- Sidebar links use `aria-current="page"`; filter chips are removable buttons with labels.
- The command palette is a dialog with a labelled input and focus trap; return focus to the trigger on close.
- The split composer and review composer need labels, `aria-describedby` for the line-per-task rule, and a visible error if submission fails.
- Status is never conveyed by color alone: every dot is paired with a word in tables and detail headers.

---

## 5. Replacing the flat list + form

| Current `panel.tsx` | This proposal |
|---|---|
| `XgRequirementsPage`: list section, then a bottom “新建需求” form | Split workspace: list spine + detail pane; create is a modal |
| Split form rendered inline inside each requirement row | One inline composer in the requirement pane, under related tasks |
| Actions (`确认`, `拆任务`) repeated on every list row | Contextual actions in the detail header; only the row selection is in the table |
| Project as a dropdown filter inside the page | Project as global context: switcher + scoped data + project page |
| `XgTasksPage`: expanded detail inside the list, attempts in the same flow | Separate task workspace with a 400px detail pane and attempts/evidence/review tabs |
| Attempts visible as a side effect of expanding a row | Attempts are a first-class detail tab and never enter a task list |
| Bottom create form, inline row split form, browser confirm for delete | Create modal, inline split composer, designed delete confirmation |
| Project/system settings conceptually mixed | Projects page separates `系统设置 · 实例` and `项目设置 · 项目` visually |

The migration can be incremental:

1. Hoist `projectId` into shared context/route state; make every page read the same project.
2. Add `id` to requirement/task routes and restore selection from the URL.
3. Replace `XgRequirementsPage` with `RequirementsWorkspace`; keep the confirm/split mutations.
4. Replace `XgTasksPage` with `TasksWorkspace` + `TaskDetailView` tabs; move attempts/artifacts/reviews into the pane.
5. Add the command palette and create modal at the shell level.
6. Keep the existing `taskTitlesFromInput` parsing and the prose warning when splitting.

**What is preserved:** confirm, split, dispatch, retry, cancel, accept, delete, review, memory confirm, inbox triage, source notes, priorities, project sensitivity, and the rule that attempts are audit data. **What changes:** the surface area of forms, the amount of scrolling, and the visibility of the project → requirement → task → attempt hierarchy.

---

## 6. Prototype tour

Open `index.html` on a 1200px-wide desktop.

1. **Requirements (default):** `DEMO` / `需求`, `#124` open. Try the status segments, `筛选` (priority/source), search, and the removable chips.
2. **Split:** with `#124` selected press `S` or click `拆任务`. Enter three lines and submit. The task count and the related task list update; the tasks page receives three `就绪` tasks.
3. **Task detail:** open `任务`, select `T-248` (`阻塞`). Inspect `运行记录` / `证据` / `评审`; press `R` to retry. Select `T-247` (`评审`) and submit a review.
4. **Create:** press `C` or click `新建需求`. Switch the project card, set a priority, create. The modal closes and the new requirement opens.
5. **Delete:** with a requirement open, click `删除`. The confirmation explains what leaves the workspace; cancel is focused.
6. **Project switch:** use the top-left switcher or the sidebar project list. Counts, requirements, tasks, inbox, memory, and reviews all change to `NEW_CENTER_APP`.
7. **Palette:** `Ctrl/Cmd + K`, type `任务` or `#124`, use `↑` / `↓` and `Enter`.
8. **Keyboard sheet:** press `?` or the help icon. `Esc` closes every layer in order.
9. **Inbox / Memory / Reviews:** triage an inbox item into a requirement, confirm a memory, and click a review row to open its task.
10. **Projects:** preview `NEW_CENTER_APP` in the project table and switch with `切换并打开`; the scope panel shows the instance vs project settings split.

---

## 7. Trade-offs and implementation risks

- **Width discipline.** A 400px detail pane leaves ~560px for the table at 1200px. Chinese titles truncate aggressively. Keep the hover title, the detail title, and the full-text copy in the pane; consider hiding the source column below 1120px (the prototype does).
- **Keyboard selection vs screen readers.** A visual grid of buttons is not a semantic table. In React use a real grid/table with `aria-selected`, roving tabindex, and an `aria-live` summary of the selected object.
- **Focus after mutations.** Confirm/close/accept can remove the selected object from the active filter. Decide whether to select the next item or close the pane; the prototype selects the next visible item. Restore focus to the table so the keyboard user does not lose their place.
- **Command palette and IME.** Guard composition and Escape carefully; a palette that re-renders mid-composition is unusable for Chinese input. The prototype avoids the re-render; a React version should use a non-rendering input or composition-aware state.
- **Long lists.** Windowing and debounced search are required for hundreds of requirements. The visual design already has fixed 40px rows, which makes virtualization straightforward.
- **Async detail.** The prototype uses synchronous mock data. In React, show a compact skeleton and keep the previous detail visible while the next loads to avoid a flashing pane.
- **Settings scope.** The prototype communicates instance vs project settings on the projects page; the actual settings screens remain out of scope for this proposal, but should reuse the same split settings navigation.
