# 00 · Final Synthesis / 项目工作台

> 由 01 Command Center、03 Linear Split、04 Kanban Canvas 合成。
> 原型：`docs/v1/ui-design/proposals/00-final/index.html`（自包含 HTML / CSS / 原生 JS，无外部字体、图片、依赖）。
> 目标视口：1200 × 830 桌面；数据：`DEMO`（演示项目 · 账单系统）、`NEW_CENTER_APP`（中心应用），另含「全部项目」聚合作用域。

## 1. 一句话

**一个项目、一个镜头、一条主列表、一块常驻详情；需要看全局时切看板，项目上下文始终不丢。**

这一版不是把三份方案拼成三页，而是把三份方案里最强的部分压进同一套壳：

- 01 的**项目常驻**和**母版-详情**；
- 03 的**高密度可扫读列表**、**筛选 chips**、**就地拆任务**、**动作贴近对象**；
- 04 的**列表/看板双视图**、**需求 4 列 / 任务 6 列**、**全部项目泳道**、**暖纸面卡片层级**。

## 2. 版式（1200 × 830）

```text
┌──────────────────────────────────────────────────────────────────────┐
│ rail 216 │ 项目上下文栏 54px                                          │
│ 项目组合  │ DEMO ▾ 演示项目 · 账单系统  活跃 内部  G:\Projects\...      │
│ 全部项目  │ 4 待确认  2 进行中  1 阻塞  2 记忆待复核  项目设置 新建需求 │
│ 3 张卡    ├──────────────────────────────────────────────────────────┤
│ 系统入口  │ 页头：眉标 / 标题 / 计数 / 列表·看板 / 7 个 tab             │
│          ├───────────────────────────────────────┬──────────────────┤
│          │ 主列表 / 看板（约 58%）               │ 详情面板（约 42%）│
│          │ 分组、筛选、40px 行、行内动作         │ 需求或任务详情    │
│          │                                       │ 独立滚动          │
│          ├───────────────────────────────────────┴──────────────────┤
│          │ 状态条 26px：项目、计数、快捷键、当前视图、1200px          │
└──────────────────────────────────────────────────────────────────────┘
```

- 左轨 216px：品牌、项目组合（全部项目 + DEMO + NCA）、全部项目脉搏、系统入口、操作者。
- 项目上下文栏 54px：项目切换、健康/敏感级/根路径、四个项目级指标、同步、项目设置、新建需求。
- 页头：眉标、21px 标题、计数、列表/看板切换、7 个可点击 tab。
- 列表模式：`minmax(0, 1fr) 428px` 的母版-详情；列表与详情独立滚动。
- 看板模式：看板占满宽度；点击卡片后在右侧浮出 432px drawer（04 的 inspector 语义），不挤压看板列宽。
- 全部项目：看板默认按项目泳道；可关闭泳道变成跨项目扁平列。

## 3. 三份方案的吸收关系

| 来源 | 具体吸收 | 在原型中的落点 |
|---|---|---|
| **01 Command Center** | 常驻项目上下文、项目组合 rail、四个项目级指标、母版-详情、系统/项目分层、阻塞在列表与详情同时可见 | 左轨 + 54px 项目栏；需求/任务均使用母版-详情；rail 底部「系统 · 全部项目」；阻塞任务行红色 rail、详情红色 banner |
| **03 Linear Split** | 40px 高密度行、状态分组、筛选 chips、独立详情、来源原话、内联拆分 composer、动作贴近对象、J/K 键盘 | 需求/任务列表；`toolbar` + `chips`；`detail-shell`；`quote` 引文块；`split-composer`；行尾 `确认/拆分/派发/重试/评审/验收` |
| **04 Kanban Canvas** | 列表/看板双视图、需求 4 列 + 任务 6 列、全部项目泳道、暖纸面、卡片层级、任务 inspector、删除确认与撤销 | `segmented-view`；`board` / `board-col`；`lane`；`--paper` 视觉；`bcard`；`detail-shell.is-drawer`；删除 modal + undo toast |
| **02 Editorial（只吸收）** | 项目身份带与阅读层级、来源原话作为引文块、单一强调色 | 项目栏的身份信息；`blockquote.quote`；最终用 cobalt 单强调，不采用大字号首屏和长卡列表 |
| **评分表** | 01 8.76 / 03 8.68 / 04 8.40 的强项组合 | 见上 |

## 4. 页面与关键交互

### 4.1 需求（默认页）

**列表**
- 状态分组：待确认 → 已确认 → 已拆分 → 已关闭；组头带「等你拍板 / 可以拆任务 / 任务在流转 / 已收口」。
- 行内容：`#seq`、标题、优先级、来源、任务状态 mini-track + `完成/总数`、阻塞 `!`、行尾动作。
- 行尾动作：待确认 → `确认`；已确认/已拆分 → `拆分`；已关闭 → `—`。动作按钮在 hover/selected 时增强，但始终可聚焦。
- 筛选：状态 segment（活跃/待确认/已确认/已拆分/全部）、优先级、来源、搜索；所有筛选以可移除 chip 呈现，`重置` 清空。
- 选择：点击行打开右侧详情；`J/K` 浏览；`S` 打开拆分；`N` 新建；`Esc` 关闭当前层。

**看板**
- 4 列：待确认 / 已确认 / 已拆分 / 已关闭，列头状态色 + 计数 + 解释。
- 卡片：优先级、标题（2 行）、来源、任务进度轨、负责人、更新时间；待确认/已确认卡片 hover 出现 `确认` / `拆分`。
- 全部项目时按 DEMO / NCA 分泳道；lane 头显示项目色、短码、数量；空 lane 显示「此列暂无」。
- 点击卡片在右侧 drawer 打开同一套需求详情；关闭后回到看板。

**需求详情**
- 头部：状态、优先级、来源、负责人、更新时间、生命周期轨迹。
- 动作：`确认需求`（仅待确认）、`拆任务`、`查看任务`。
- 正文：需求简报 → 来源原话（引文块）→ 验收口径 → 任务构成（状态轨、`完成/总数`、任务行）→ 元信息。
- `拆任务` 在任务构成下方就地展开，不跳页。
- 任务行点击进入任务页并选中对应任务，形成需求 ↔ 任务双向路径。
- 不提供「关闭需求 / 删除需求」：当前接口契约没有需求关闭/删除端点，原型不伪造契约外动作（01 的边界判断）。任务删除是契约中已有的软删除。

**新建需求 compositor**
- 项目栏 `新建需求`、`N`、空状态入口均可打开右侧 sheet。
- 字段：项目（单项目上下文锁定，全部项目时可选）、标题（必填）、优先级、来源、来源备注、描述、来源原话。
- 「最近需求 · 避免重复」列出当前作用域最近 4 条；「填入示例」填充当前项目的示例。
- 校验：标题为空时显示错误并聚焦标题；`Ctrl/Cmd + Enter` 提交；创建后自动进入需求页并选中新需求（待确认）。

**拆任务 compositor**
- 每行一个任务；逗号、分号不拆，只有换行才拆（与 `taskTitlesFromInput` 语义一致）。
- 实时显示「将拆出 N 个任务」和标题 chips；如果多行看起来像一段话被误拆，显示琥珀色提示。
- 类型、优先级、验收标准应用到本批全部任务；验收标准可留空，默认继承需求验收口径。
- 提交后需求变为「已拆分」，任务进入「就绪」，任务数、分组计数、项目栏指标、概览队列同步更新；新任务按输入顺序排列。

### 4.2 任务

**列表**
- 按操作优先级分组：阻塞 → 评审 → 待验收 → 进行中 → 就绪 → 完成。
- 行内容：`T-seq`、状态点+文字、标题、类型、优先级、所属需求、行尾动作。
- 行尾动作：就绪 → `派发`；阻塞 → `重试`；评审 → `评审`；待验收 → `验收`；进行中/完成 → `—`。
- 列表**不展示 Attempt**；只展示当前状态与阻塞提示。

**看板**
- 6 列：就绪 / 进行中 / 评审 / 待验收 / 完成 / 阻塞。
- React 落地版本额外含「取消」列（共 7 列）；原型保留 6 列，取消任务在列表中处理。
- 1200px 下 6 列全部可见（最小 148px，必要时横向滚动）；卡片不展示 attempt/证据/评审数量。
- 全部项目时按项目泳道；单项目时不显示项目 chip，避免重复信息。
- 阻塞卡显示砖红原因条；完成/关闭卡降低对比度。

**任务详情**
- 头部：状态、类型、优先级、负责人、更新时间、`T-xxx`；所属需求可点回需求详情。
- 阻塞时顶部红色 banner：原因 + 已阻塞时长。
- 验收标准 + 规格块。
- 三个 tab：**运行记录**（Attempt 时间线、阶段、Session、启动时间、时长、报告、错误块）、**证据**（LOG/CMD/CODE/DOC/EVIDENCE 卡片）、**评审**（评审历史；状态为评审时显示内联评审表单）。
- 底部固定动作栏：`删除`（软删除确认）+ 状态动作（派发 / 重试 / 写评审 / 验收通过）。
- 删除确认 modal：任务编号、标题、项目、所属需求、软删除说明；取消默认聚焦；确认后 toast 提供**撤销**。运行记录、证据与评审保留在审计中；评审页对已删除任务显示「任务已删除 · 审计记录保留」的只读行。

### 4.3 概览

- 一句话叙事：`N 件待你处理，M 条执行线在跑。`
- 「待你处理」按紧急度：阻塞 → 待确认 → 评审 → 待验收 → 记忆；每行直接给动作。
- 深色执行脉搏卡：正在跑的 task、阶段轨、已运行时长、tokens、Attempt、Worker；可进入详情。
- 项目 mini 列表、最近活动、本周节奏 sparkline。
- 顶部不再重复「打开需求/打开任务」按钮，只在页头保留一组。

### 4.4 项目 / 系统设置边界

这是全稿刻意强化的层级：

- 项目栏只放**项目级**信息：项目短码/名称、状态、敏感级、根路径、项目指标、`项目设置`。
- 左轨底部独立「**系统 · 全部项目**」块：Worker 并发、默认模型、`系统设置`。
- 项目页：
  - 上方「项目 · 项目级」两张项目卡；
  - 下方虚线、带 SYSTEM 标记的「**系统设置 · 影响本实例所有项目**」面板；
  - 明确文案：项目设置只改根路径、默认优先级、自动派发、敏感级与 Worker 覆盖；模型密钥、并发、来源连接、部署属于系统级。
- 两个 modal 视觉上分层：
  - 项目设置：蓝色「项目级 · 仅作用当前项目」tag；
  - 系统设置：深色 band「系统级 · 影响本实例所有项目」。
- 「全部项目」作用域下项目栏的 `项目设置` 禁用（没有单一项目），项目设置仍可从项目卡进入。
- 不把两者合并成一个设置页；系统设置页仍属于后续「设置 → 系统设置」的入口。

### 4.5 收件箱 / 记忆 / 评审

- **收件箱**：渠道消息列表 + 原文；`转为需求` 打开预填的 create sheet，创建后移出队列；`忽略` 直接移除并 toast，不创建对象。
- **记忆**：按待复核/已确认/草稿分组；详情显示内容、来源、引用路径、校验状态；`确认记忆` / `退回草稿` / `提交复核` / `检查引用` 就近出现。确认后自动切到目标状态分组，避免详情与列表脱节。
- **评审**：左侧「待我评审」队列 + 历史结论；右侧展示验收标准、最近尝试、历史结论和内联评审表单；`通过 → 待验收`、`退回 → 进行中`；可打开任务详情。历史中的已删除任务保留只读审计行。

## 5. 状态、路由与键盘

### 5.1 作用域

- `scope`：`DEMO` | `NEW_CENTER_APP` | `ALL`。
- 单项目作用域下所有需求/任务/记忆/收件/评审按 `project` 过滤。
- `ALL` 下：
  - 指标、tab 计数为聚合值；
  - 看板默认按项目泳道；
  - 列表行/扁平看板卡片显示项目短码；
  - 新建需求时允许选择归属项目。

### 5.2 原型状态

```js
state = {
  tab, scope, reqView, taskView,
  reqStatus, taskStatus, reqQ, taskQ,
  reqPriority, reqSource, taskType, taskPriority,
  selectedReq, selectedTask, selectedInbox, selectedMemory, selectedReview,
  detailTab, splitOpen, splitDraft, splitReqId,
  createOpen, create, createError, triageFrom,
  deleteTarget, settingsModal, settingsProject,
  projectMenu, filterMenu, lanes, memStatus,
  reviewDecision, reviewComment, reviewError, lastDeleted
}
```

- 列表与详情共享一个选中 id，不复制详情对象；所有 mutation 后重新渲染，计数从同一数据源派生。
- 项目切换清空临时筛选，保留当前 tab 与视图模式；看板模式下状态筛选保持 `all`，避免空列。
- 选中对象变化时详情滚动回顶部；同一对象内 mutation 保留滚动位置。
- 筛选搜索重渲染后恢复输入焦点与光标；中文输入法 composition 期间跳过重渲染。

### 5.3 键盘

| 键 | 行为 |
|---|---|
| `1`–`7` | 切换 7 个 tab |
| `J` / `K` | 列表内移动选中项（需求/任务） |
| `N` | 新建需求 sheet |
| `S` | 需求详情打开/聚焦拆任务 composer |
| `D` / `R` / `A` | 任务页：派发 / 重试 / 验收（符合当前状态时） |
| `/` | 聚焦当前需求/任务搜索 |
| `Ctrl/Cmd + Enter` | 提交当前 create / split / review 表单 |
| `Esc` | 浮层 → 筛选/项目菜单 → 删除/设置 modal → create sheet → split → 关闭详情 / blur 输入 |

## 6. 映射到 React

### 6.1 外壳

建议把项目上下文提升到所有 xg 页面之上，不再由每个页面各自渲染项目筛选：

```tsx
<WorkspaceShell>                         // project scope + route + counts
  <ProjectRail                           // left portfolio + system entry
    projects={projects}
    activeScope={scope}
    counts={railCounts}
    onScope={setScope}
    onOpenSettings={openSystemSettings} />
  <ProjectContextBar                     // 54px persistent bar
    scope={scope}
    project={project}
    metrics={projectCounts}
    onScope={setScope}
    onOpenProjectSettings={openProjectSettings}
    onNewRequirement={openCreateSheet} />
  <WorkspaceHeader                       // title + tabs + view toggle
    tab={tab} counts={counts}
    onTab={setTab}
    view={view} onView={setView} />
  <main>{tab === 'requirements' ? <RequirementsWorkspace ... /> : ...}</main>
  <WorkspaceStatusBar />
</WorkspaceShell>
```

现有 `src/client/app.tsx` 已经维护 7 个 tab 的 `TABS` 与 `Route`；建议保留一级信息架构，把 `project`、`view`、`filters` 与选中对象加入 route/query，而不是在每个页面里各放一个项目下拉。

### 6.2 组件拆分

| 原型区域 | 建议 React 组件 | 数据/接口 |
|---|---|---|
| 左轨项目组合 | `ProjectRail`, `ProjectCard`, `SystemScopeCard` | `GET /projects` + 已加载列表派生计数 |
| 54px 项目栏 | `ProjectContextBar`, `ProjectSwitcher`, `ProjectMetrics`, `ProjectSettingsButton` | 当前 project + counts |
| 页头 | `WorkspaceHeader`, `TabBar`, `ViewToggle` | route + counts |
| 需求筛选 | `RequirementToolbar`, `FilterPopover`, `FilterChips`, `SearchField` | `GET /requirements?projectId` |
| 需求列表 | `RequirementList`, `RequirementGroup`, `RequirementRow` | 客户端按 status/priority/source 过滤 |
| 需求看板 | `RequirementBoard`, `BoardColumn`, `Swimlane`, `RequirementCard` | 同上；`ALL` 时按 project 分 lane |
| 需求详情 | `RequirementDetail`, `SourceQuote`, `AcceptanceList`, `TaskComposition`, `LifecycleTrail` | 选中需求 + `tasksForReq` |
| 拆分 | `SplitTaskComposer` | `POST /requirements/:id/split` |
| 新建 | `CreateRequirementSheet` | `POST /requirements` |
| 任务筛选 | `TaskToolbar`, `FilterPopover`, `FilterChips` | `GET /tasks?projectId&status` |
| 任务列表 | `TaskList`, `TaskGroup`, `TaskRow` | 客户端过滤/分组 |
| 任务看板 | `TaskBoard`, `BoardColumn`, `Swimlane`, `TaskCard` | 同上 |
| 任务详情 | `TaskDetail`, `TaskMeta`, `BlockedBanner`, `DetailTabs` | `GET /tasks/:id` 懒加载 |
| 运行记录 | `AttemptTimeline`, `AttemptItem` | `detail.attempts` |
| 证据 | `EvidenceGrid`, `EvidenceCard` | `detail.artifacts` |
| 评审 | `ReviewPanel`, `ReviewForm`, `ReviewHistory` | `POST /tasks/:id/review` |
| 删除 | `DeleteTaskDialog` | `POST /tasks/:id/delete`（软删除） |
| 设置 | `ProjectSettingsModal`, `SystemSettingsModal` | `GET/POST /projects/:id/settings` + 系统设置 |

可复用 `src/client/controls.tsx` 的 `Button / Input / Tag / Pill / Modal`，并新增：

- `Sheet`（右侧 compositor，或扩展 Modal 的 side variant）；
- `StatusPill`、`PriorityMark`、`SourceIcon`、`Kbd`、`Sparkline`；
- `Segmented`（状态过滤）、`Chips`、`FilterPopover`；
- `Board`、`BoardColumn`、`Lane`、`BoardCard`；
- `EmptyState`、`Toast`（带 undo action）。

不建议引入第三方 UI 库。现有 `xg.css` 可扩展，也可新增 `src/client/xg/workspace.css`，沿用 `xg-` 前缀。

### 6.3 复用的现有逻辑

- `taskTitlesFromInput`：拆任务仍按换行拆，逗号/分号不拆。
- `splitLooksLikeProse`：多行看起来像一段话时提示。
- `useXg`：项目、需求、任务列表的加载/错误/刷新。
- `useMutation`：确认、拆分、派发、重试、验收、评审、删除的 busy 态与防重复。
- `TaskDetailView` 中的运行记录/产物/评审子块可直接搬进 `TaskDetail` 的 tabs，但必须从“列表行内展开”改为“独立详情面板”。
- 现有 `Modal` 的 focus/disabled 处理可继续复用；新增 sheet/drawer 时补焦点陷阱与关闭后焦点返回。

### 6.4 路由建议

```ts
type WorkspaceRoute =
  | { page: 'requirements'; project: ProjectId | 'ALL'; reqId?: string;
      view?: 'list' | 'board';
      status?: ReqStatusFilter; priority?: Priority; source?: Source; q?: string }
  | { page: 'tasks'; project: ProjectId | 'ALL'; taskId?: string;
      view?: 'list' | 'board'; status?: TaskStatusFilter; type?: TaskType;
      priority?: Priority; q?: string }
  | { page: 'inbox'; project: ProjectId | 'ALL'; inboxId?: string }
  | { page: 'memory'; project: ProjectId | 'ALL'; memoryId?: string }
  | { page: 'reviews'; project: ProjectId | 'ALL'; taskId?: string }
```

URL 示例：

```text
?tab=requirements&project=DEMO&req=r124&view=list
?tab=requirements&project=ALL&view=board
?tab=tasks&project=DEMO&task=t248&view=list
?tab=tasks&project=ALL&view=board&lanes=1
```

- `project` 必须进入 URL/session；否则刷新后无法恢复“先项目、后对象”。
- 选中对象、视图、筛选也建议进入 URL；浮层（create/split/delete/settings）保留本地 state。
- `ALL` 是作用域，不是伪项目；不要把聚合计数写进单项目缓存。

### 6.5 API 对应

| 交互 | 端点 |
|---|---|
| 项目列表 | `GET /projects` |
| 需求列表 | `GET /requirements?projectId=` |
| 新建需求 | `POST /requirements` |
| 确认需求 | `POST /requirements/:id/confirm` |
| 拆任务 | `POST /requirements/:id/split`（body `{ tasks: XgTaskSplitInput[] }`） |
| 任务列表 | `GET /tasks?projectId=&status=` |
| 任务详情 | `GET /tasks/:id`（懒加载，Attempt 不进入列表） |
| 派发 / 重试 / 验收 | `POST /tasks/:id/dispatch` / `/retry` / `/accept` |
| 评审 | `POST /tasks/:id/review` |
| 删除任务 | `POST /tasks/:id/delete`（软删除，保留审计） |
| 收件转需求 / 忽略 | `POST /inbox/:id/triage` / `/ignore` |
| 记忆确认 / 退回 / 校验 | `POST /memory/:id/confirm` / `/reject`、`POST /memory/verify` |
| 评审历史 | `GET /reviews?projectId=` |
| 项目设置 | `GET/POST /projects/:id/settings` |
| 系统设置 | 现有系统设置页（模型、并发、连接、密钥），不与项目设置合并 |

**真实实现以接口返回为准**：原型为了演示，评审通过→待验收、退回→进行中、派发→进行中是本地推进；React 实现必须使用服务端返回的 `task` 状态，不要硬编码。拆分后的任务数量与顺序也应以服务端返回为准。

### 6.6 视觉 token 映射

| 原型变量 | 含义 | 建议工作台 token |
|---|---|---|
| `--paper` / `--paper-2` | 暖纸面 / 次层 | `--dsw-alias-bg-base` / `--dsw-alias-bg-layer-2` |
| `--panel` | 白色面板 | `--dsw-alias-bg-layer-2` / `--dsw-alias-bg-module-platform` |
| `--line` / `--line-strong` | 1px 细线 | `--dsw-alias-border-l3` / `l4` |
| `--ink` / `--ink-2` / `--ink-3` | 主/次/三级文字 | `--dsw-alias-label-primary` / `secondary` / `tertiary` |
| `--accent` `#2547e8` | cobalt 单强调 | 选中、链接、focus；可映射到项目强调 token |
| `--green` / `--amber` / `--red` / `--violet` | 状态语义 | success / warn / error / business |
| `--shadow-1` | 卡片软阴影 | `--dsw-elevation-soft` + 1px 边框 |

- 中文正文 12px、表格标题 12px、详情标题 17–21px、元信息 8–10px；目标 1200px。
- 状态永远“颜色 + 文字 + 点”，不单靠颜色。
- 断点：≤1240 收窄 rail/详情；≤1150 隐藏来源列/根路径/同步；≤1080 的看板列允许横向滚动。原型仍以 1200 为验收尺寸。

## 7. 与三份原始方案的取舍

| 决策 | 原因 |
|---|---|
| 列表模式用 428px 内联详情；看板模式用 432px 右侧 drawer | 列表需要稳定的母版-详情；看板需要保留列宽与空间关系。两者共用同一个详情组件。 |
| 任务 6 列在 1200 下全部可见（148px 最小） | 满足“6 状态列”要求；窄屏再横向滚动。04 原型的 180px 列在 1200 下会切掉一列。 |
| 不做拖拽 | 当前后端是 action 端点（派发/重试/评审/验收），不是任意 status PATCH；拖拽映射容易伪造非法迁移。原型用行尾/卡片 hover 动作与详情底部动作覆盖同一流程。若后续加入拖拽，应只对合法方向显示投放高亮并映射到这些 action。 |
| 不做需求关闭/删除 | 现有契约没有需求关闭/删除端点；不伪造。任务删除有软删除端点。 |
| 不做命令面板 | 需求是“七 tab + 项目切换 + 筛选/搜索 + 就近动作”；搜索/筛选已覆盖主要路径，避免额外焦点/IME 复杂度。 |
| 新建需求用右侧 sheet，而不是页面底部表单 | 01 的 drawer 语义；创建后自动选中，不离开需求上下文。 |
| 全部项目默认泳道 | 避免把两个项目的卡片混在一列里猜归属；可手动关闭泳道。 |
| 评审历史保留已删除任务的只读行 | 与删除 modal 的“审计保留”承诺一致。 |
| 记忆确认后自动切换状态分组 | 避免列表仍停在待复核、详情却已确认的脱节。 |

## 8. 原型边界

- 所有数据在内存中；刷新回到初始 mock。没有网络请求、没有 localStorage。
- 所有图标为内联 SVG symbol；无外部字体/图片/库。
- 评审、派发、验收、拆分后的状态是本地推进，仅用于演示；真实服务端状态优先。
- 没有实现移动端；1200px 桌面为验收尺寸。
- 没有完整焦点陷阱；modal 默认焦点、Esc 关闭、行键盘可达已实现，生产实现需补完整 dialog focus trap。
- 没有需求编辑/关闭/删除、独立任务创建（任务只从需求拆分产生，符合现有产品语义）。
- 系统设置只演示边界与关键字段，不替代完整系统设置页。

## 9. 验收清单

- [x] 7 个可点击 tab：概览 / 项目 / 需求 / 任务 / 收件箱 / 记忆 / 评审。
- [x] 项目切换：左轨、项目栏菜单；`DEMO` / `NEW_CENTER_APP` / `全部项目`；切换后 tab、计数、列表、看板、详情同步。
- [x] 需求页：项目上下文、状态分组列表 / 4 列看板、筛选 chips、右侧详情；来源原话、验收口径、任务构成、确认、拆分。
- [x] 新建需求右侧 sheet：项目、标题必填、优先级、来源、描述、原话、最近需求、示例、校验、自动选中。
- [x] 就地拆任务：每行一个、逗号不拆、实时数量与 chips、误拆提示、类型/优先级/验收标准、提交后状态与任务同步。
- [x] 任务页：6 状态分组列表 / 6 列看板；行尾派发/重试/评审/验收；详情 attempts/evidence/review/actions。
- [x] 删除任务：自定义确认 modal、取消默认聚焦、软删除说明、确认后 toast + 撤销；评审历史保留审计行。
- [x] 全部项目看板：需求 4 列 / 任务 6 列，项目泳道，lane 开关。
- [x] 系统/项目边界：项目栏项目级信息、rail 系统入口、项目页系统面板、两种分层 modal。
- [x] 概览、项目、收件箱、记忆、评审可用。
- [x] 键盘：1–7、J/K、N、S、D/R/A、/、Ctrl/Cmd+Enter、Esc。
- [x] 1200 × 830 桌面；无外部资源；浏览器测试 0 console errors（真实 Chromium 交互回归）。

## 10. 文件

```text
docs/v1/ui-design/proposals/00-final/
  index.html   # 合成原型（自包含）
  notes.md     # 本文件
```

未修改 `src/` 下任何文件。
