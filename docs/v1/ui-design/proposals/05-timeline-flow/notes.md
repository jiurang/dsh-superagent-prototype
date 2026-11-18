# 05 · Timeline / Flow Workspace

> 把工作看成一条持续向前的承诺流：左侧是已经发生的事，右侧是此刻需要人的事，顶部始终知道自己站在哪个项目里。

- 预览：`index.html`（自包含，直接浏览器打开）
- 数据：`DEMO`（演示项目 · 账单系统）、`NEW_CENTER_APP`（中心应用）
- 目标宽度：1200px 桌面；更宽时最大 1320px，保留工作台边框感

---

## 1. 概念

工作台不是一个“指标面板”，也不是若干列表的集合。它应该回答三个连续的问题：

1. **我在哪个项目里？** —— 顶部固定项目上下文；
2. **这里最近发生了什么？** —— 中央按时间排列的承诺流；
3. **现在轮到我做什么？** —— 右侧「此刻」只放需要人判断的事。

需求不是孤立列表，而是承诺的容器；任务不是孤立列表，而是需求的切片；执行尝试、证据与评审不进入任务列表，只在任务详情的时间线里出现。界面的“流”感来自这三层不同的时间尺度：

- **项目**：持续数周 / 数月的上下文；
- **需求与任务**：数天 / 数小时的推进；
- **尝试、报告、评审**：分钟级的信号。

原型用一条细轨、一组状态点和一层浅色画布，把三种尺度放在同一个阅读路径里，同时不把它们混成一个看不出层级的活动日志。

---

## 2. 视觉语言

### 画布与层级

| 层 | 色值 / 规则 | 用途 |
| --- | --- | --- |
| 画布 | `#F7F6F0` + 极淡的 cobalt 光晕 | 时间线底色，避免纯白的“表格感” |
| 卡片 | `#FFFFFF`，1px `#E4E2D8` | 右栏、需求卡片、弹层 |
| 主文本 | `#1A1A1F` | 标题、任务名 |
| 次文本 | `#69685F` | 事件描述、来源 |
| 弱文本 | `#8B897E` | 时间、计数、辅助信息 |
| 主强调 | `#2547E8` | 当前 tab、主按钮、当前/进行中的信号 |
| 成功 | `#2F7D59` | 完成、验收、通过 |
| 等待 | `#A96F15` | 待确认、评审、待验收 |
| 阻塞 | `#BE4438` | 阻塞、失败、删除 |

- **单一强强调**：cobalt 只给需要行动或表示当前状态的地方。状态点另用语义色，但因为面积很小，不会形成第二套主题色。
- **细轨**：时间线使用 1px 竖线和 6–7px 的状态点，事件之间靠间距和字号分层，不靠卡片边框。
- **日期是锚点**：每天有 sticky 的日期头，滚动时仍然知道自己处在哪一天。
- **中文优先**：字号在小尺寸上保持克制；时间、ID、代码使用等宽字体，避免与中文正文混淆。

### 字体与尺寸

- 正文 12–13px；辅助元信息 9.5–10.5px；只在“可扫读标签”上使用 9px。
- 标题 23px，页面副标题 12px，右侧当前项目名 14px。
- 所有数字使用 `tabular-nums`，时间和尝试 ID 使用 mono。
- 交互热区至少 32px（主按钮 33px，小按钮 28px，行内按钮 23px 只用于低风险操作）。

---

## 3. 布局与专注模型

```text
┌──────────────────────────────────────────────────────────────┐
│ 雄大工作台   [DEMO 演示项目 · 账单系统 ▾]      搜索  铃铛  你 │ 58
├──────────────────────────────────────────────────────────────┤
│ 概览   项目   需求   任务   收件箱 4   记忆   评审            │ 45
├──────────────────────────────────────────────────────────────┤
│ DEMO │ 演示项目 · 账单系统  活跃 内部                           │ 68 sticky
│      │ 根路径 · 4 个未关闭需求 · 最近活动 11 分钟前             │
│      │                              4 待你  1 进行中  1 阻塞  [+ 新建需求]
├──────────────────────────────────────────────────────────────┤
│ 工作流 / 当前项目 / 全部项目                                   │
│ 承诺条：待确认 1 · 已确认 1 · 已拆分 2 · 已关闭 1              │
│ ┌───────────────────────────────────────┐  ┌──────────────┐ │
│ │ 活动  全部 承诺 执行 评审 收件          │  │ 此刻  4 件   │ │
│ │                                       │  │ 需求待确认   │ │
│ │ 今天  11月17日 周二          6 条      │  │ 阻塞         │ │
│ │ 14:21  ● 报告 …                       │  │ 等你评审     │ │
│ │ 14:08  ○ 收件 …                       │  │ 记忆待复核   │ │
│ │ 13:54  ● 执行 …                       │  │ ─────────    │ │
│ │ …                                     │  │ 正在发生     │ │
│ │ 昨天  11月16日 周一          …         │  │ 接下来       │ │
│ │                                       │  │ 收件箱 →     │ │
│ └───────────────────────────────────────┘  └──────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

### Focus 模式

- **当前项目**是默认镜头：时间线、右侧「此刻」、上下文指标都只反映这个项目。
- 顶部的项目条是 **sticky** 的；滚动时间线时，项目、状态、未关闭需求数、待你/进行中/阻塞始终可见。
- 顶部切换器负责“换项目”；时间线右上角的 `当前项目 / 全部项目` 负责“换镜头”。
- 选择 `全部项目` 后，sticky 条会切换成 portfolio 版本（`2P`、`PORTFOLIO`、跨项目计数、待你 7）；在需求页选择 `全部项目` 时同样如此，保证顶部计数与页面上的 9 条需求一致。右侧「此刻」在概览的全景镜头下同时变为跨项目汇总。离开概览的全景镜头进入其它 tab 时，上下文条回到当前项目；需求页的“全部项目”是页面级透视图，会保留该页的范围选择。这一层是刻意的：**项目是上下文，全景是局部观察镜**。
- `专注`不是第二个开关，而是整个页面的默认形态；当用户进入某个项目时，其他项目的时间线不应自动闯入。

---

## 4. 信息层级

```text
系统
└─ 项目（顶部上下文 + 项目页）
   └─ 需求（项目内按状态分组）
      └─ 任务（需求展开后出现）
         └─ 执行尝试 / 报告 / 证据 / 评审 / 验收（任务详情的执行时间线）
```

- **项目**：顶部上下文条与「项目」页；项目卡直接给出未关闭需求、推进中任务、此刻待你、阻塞。
- **需求**：项目页内按 `待确认 / 已确认 / 已拆分 / 已关闭` 四组排列；展开后在原位显示任务，不跳页。
- **任务**：只在需求展开体与任务 tab 中出现；每行只显示“最新尝试”，不显示完整尝试历史。
- **尝试/证据/评审**：只在任务右侧的 detail sheet 中合并成一条时间线，最新在上。
- 页面上的“任务数”始终是需求的下一层；“最新尝试”是任务的最小可观察状态；“完整运行记录”是详情层。

### 需求展开体

- 来源原话与描述用带左侧细线的引文块，不抢标题层级。
- 需求动作（确认、拆任务、在时间线中查看）出现在展开体内，符合“重要动作就近出现”。
- 任务行固定显示：状态点、任务名、类型、优先级、最新尝试（状态 / 阶段 / 多久前报告 / 打开）。
- 任务列表里不出现 attempt 列表；只出现 attempt 的**摘要**。

---

## 5. 时间线模型

### 事件类型

| kind | 语义 | 点色 | 归入过滤 |
| --- | --- | --- | --- |
| `requirement` | 需求创建（含从收件转入） | ink | 承诺 |
| `split` | 需求拆出任务 | ink | 承诺 |
| `confirm` | 需求确认 | cobalt | 承诺 |
| `attempt` | 执行 / 评审尝试开始 | cobalt | 执行 |
| `report` | 执行器报告；失败为红点 | green / red | 执行 |
| `evidence` | 证据提交 | green | 执行 |
| `review` | 评审通过 / 退回 | green / red / amber | 评审 |
| `accept` | 验收通过 | green | 评审 |
| `inbox` | 收到新消息 | 空心灰 | 收件 |

- 事件以**最新在上**排列；日期分组，组头 sticky。
- 每条事件只保留一个粗体标题 + 一行可选原文 + 少量 chips；超过两行的细节不进入流。
- 事件行本身是入口：创建/拆分/确认打开需求；尝试/报告/证据/评审/验收打开任务；收件打开收件箱。
- 需要处理的异常（阻塞、失败）用红点 + 外圈 + 红色 chip，而不是整行铺红。
- “刚刚”由原型时钟模拟；实际产品建议按服务端时间线游标拉取，避免客户端拼装事件顺序。

### 任务详情时间线

任务 sheet 将以下数据合并为一条按时间排序的时间线（原型最新在上）：

1. 任务创建（来源需求、类型、优先级）；
2. 每次 attempt 的开始（阶段、会话）；
3. 该 attempt 的每条 report；
4. 该 attempt 的 artifact（证据 / 代码 / 文档）；
5. attempt 结束或阻塞；
6. review（通过 / 退回，含评审意见）；
7. acceptedAt（验收人、时间）。

这比“运行记录表格 + 产物列表 + 评审列表”更接近真实认知：用户是在读一个任务如何变成交付物的故事，而不是在三张表之间对照 ID。

### 「此刻」不是第二个待办列表

右侧只计算 **需要人判断** 的状态：

| 来源 | 条件 | 动作 |
| --- | --- | --- |
| 需求 | `待确认` | 直接确认（P0 优先置顶） |
| 任务 | `阻塞` | 打开任务，查看阻塞原因 / 重试 |
| 任务 | `评审` | 打开任务，直接给评审结论 |
| 任务 | `待验收` | 打开任务，按验收标准验收 |
| 记忆 | `待复核` | 进入记忆页并定位到该条 |
| 收件箱 | 未处理 | 仅显示汇总入口，不把每条消息塞进「此刻」 |

排序：P0 待确认 → 阻塞 → 普通待确认 → 评审 → 待验收 → 记忆。P0 承诺优先于一般阻塞，因为前者还没有进入任何执行；数量与顶部“待你”一致。

「正在发生」展示正在运行的 attempt；「接下来」展示已确认但未拆的需求、就绪任务；这样右栏除了“等你”也有“工作正在走”的生命感。

---

## 6. 需求页：按项目 + 状态分组

- 选择 `当前项目` 时只显示当前项目卡片；选择 `全部项目` 时显示两个项目卡片。
- 每个项目卡片内部按四个状态分组，每组有自己的状态点、数量与一句解释（例如“等你确认后再拆任务”）。
- 顶部状态筛选是同一份数据的透视图；筛选后只保留该状态的组，减少一次页面跳转。
- 组内需求行折叠；展开后原位出现来源、描述、动作和任务。
- 默认展开一条 `已拆分` 需求（DEMO 中是“对账单列表按客户聚合”），让页面第一眼就展示“需求 → 任务 → 最新尝试”的层级，而不是只看到列表。
- 全部项目视图会在每个需求行前保留 `#seqNo`，并在项目头显示项目代号与敏感级，防止跨项目误读。
- requirement 的快速动作：`待确认` 行右侧直接给“确认”，`已确认` 行右侧直接给“拆任务”；其余动作在展开体里。

---

## 7. 交互模型

### 全局

| 交互 | 反馈 |
| --- | --- |
| 七个 tab | 切换工作区；离开概览时退出全景镜头 |
| 项目切换器 | 下拉选择项目，切换后回到该项目的概览；toast 确认 |
| `当前项目 / 全部项目` | 更新时间线、承诺条、右栏与上下文条；portfolio 上下文显示全局计数 |
| `⌘K / Ctrl+K` | 聚焦全局搜索；搜索覆盖需求、任务、记忆 |
| 通知铃铛 | 打开「此刻」摘要；点击条目跳转 |
| 左侧品牌 | 回到当前项目的概览 |

### 需求

| 交互 | 反馈 |
| --- | --- |
| 点击需求行 / 标题 | 展开/收起；chevron 旋转；行保持原位 |
| 确认 | 状态 `待确认 → 已确认`，写入时间线事件、更新顶部计数、右栏消失对应项 |
| 拆任务 | 打开右侧 slide-over；显示需求上下文与任务行预览 |
| 在时间线中查看 | 回到概览，滚动并高亮该需求相关事件 |
| 新建需求 | 右侧 slide-over；可勾选“创建后继续拆任务” |

### 新建 / 拆任务 Composer

- 新建需求字段：项目、标题、P0–P3、来源/背景、创建后继续拆任务。
- 拆任务字段：任务标题（每行一个）、任务类型、优先级、验收标准。
- **实时预览**：每行即时生成为带编号的任务列表；标题数量与“拆出 N 个任务”按钮同步。
- **防误拆**：行内逗号/句号不拆；若多行看起来像一整句话被拆开，出现黄色提示。复制现有 `taskTitlesFromInput` 的语义。
- 创建后若勾选继续拆，直接切换为拆任务 composer；背景已经切到需求页并展开新需求。
- 收件转需求复用同一个 composer，顶部保留来源原文；提交后收件状态变为“已建需求”。

### 任务详情

- 从任务列表、需求展开体、时间线事件或「此刻」打开右侧 760px sheet。
- 顶部：项目 / 需求 / 任务面包屑，标题、类型、优先级、当前状态、尝试与会话。
- 状态即动作：
  - `评审`：amber 卡片，评论文本框 + `退回` / `通过并转待验收`；
  - `待验收`：cobalt 卡片，展示验收标准 + `验收通过`；
  - `阻塞`：红色卡片，展示原因 + `重试派发`；
  - `就绪`：灰色卡片 + `派发`。
- 下方是验收标准、所属需求、规格；再往下是执行时间线。
- 删除在 header 与底部都可触达；打开居中确认对话框，说明“从列表与统计中消失，但运行记录、证据与审计保留”。
- 评审结果与验收动作会即时写入任务时间线；sheet 保持打开，用户能看到结果而不是被踢回列表。

### 收件箱 / 记忆 / 评审

- 收件箱：保留原话，逐条“转需求”或“忽略”；右侧固定“分诊原则”。
- 记忆：按状态筛选；待复核 / 草稿可以确认或退回；确认后进入项目上下文。
- 评审：待评审任务在顶部，一键打开任务 sheet 的评审区；历史评审保留 reviewer、结论和时间。

### 键盘与可访问性

- `⌘K / Ctrl+K` 搜索，`Esc` 关闭最上层（删除确认 → composer → 任务 sheet → 菜单）。
- 需求标题是真正的按钮；任务行是按钮；项目菜单和弹层使用 `aria-expanded` / `role="dialog"` / `aria-modal`。
- 状态永远同时有文字标签和颜色，不依赖颜色单独传达。
- 原型在 `prefers-reduced-motion` 下关闭动画。

---

## 8. 状态模型与派生规则

原型中的核心状态：

```js
state = {
  tab: 'overview',
  projectId: 'p-demo',
  timelineScope: 'project' | 'all',
  eventFilter: 'all' | 'commit' | 'exec' | 'review' | 'inbox',
  reqScope: 'current' | 'all',
  reqStatus: 'all' | '待确认' | '已确认' | '已拆分' | '已关闭',
  expandedReq: string | null,
  taskFilter: 'all' | TaskStatus,
  memoryFilter: 'all' | MemoryStatus,
  detailTaskId: string | null,
  composer: { mode: 'create' | 'split' | 'triage', reqId?, inboxId? } | null,
  deleteTaskId: string | null,
}
```

派生数据不存放在 state：

- **承诺条**：按当前镜头过滤需求，统计 4 个状态的 count；关闭项仍显示但变淡，因为它属于同一条承诺的完整生命周期。
- **「此刻」**：由需求 / 任务 / 记忆的当前状态计算，不维护第二份待办列表。
- **「正在发生」**：任务状态 `进行中` + 最新 attempt。
- **「接下来」**：已确认且无任务的需求；`就绪` 任务。
- **最新尝试**：`currentAttemptId` 优先，否则取该任务最后一条 attempt。
- **任务时间线**：任务 + attempts/reports + artifacts + reviews + acceptedAt 归并排序。
- **项目统计**：项目卡中的未关闭需求、推进中任务、阻塞、待你。

原型使用固定时钟 `2026-11-17 14:32`；用户操作产生的事件按 +1 分钟递增，让“刚刚”的反馈可见。真实实现应以服务端 `createdAt` / `updatedAt` 和统一时区为准。

---

## 9. React 映射

### 与现有代码的关系

现有 `app.tsx` 已经有七个 tab 与 `XgProjectsPage / XgRequirementsPage / XgTasksPage / XgInboxPage / XgMemoryPage / XgReviewsPage`。本方案不改变 tab 路由，而是：

1. 用 `XgFlowPage` 替换 `overview` tab 的内容（或新增 `flow` 作为默认页）；
2. 把 `projectId` 从各页面的局部 filter 提升为 Xg 层共享上下文；
3. 复用现有的 `useXg`、`useMutation`、`useTaskDetail` 和 API path，不引入第三方 UI 库。

建议的组件树（保留 `app.tsx` 的 Header、Tabs 与路由，只在 xg 页面内增加项目上下文）：

```tsx
<Pages>                                 // existing app.tsx
  <Header />                            // existing global search / help / session
  <SegmentedTabs />                     // existing 7 tabs
  <main>
    <XgProjectProvider>                 // new: shared project context
      {route.page === 'overview' && (
        <XgFlowPage
          project={project}
          scope={scope}
          onScopeChange={setScope}
          eventFilter={filter}
          events={events}
          nowItems={nowItems}
          running={running}
          next={next}
          onOpenTask={...}
          onOpenRequirement={...}
          onCreateRequirement={...}
        />
      )}
      {route.page === 'requirements' && <XgRequirementGroups ... />}
      {route.page === 'tasks' && <XgTaskList ... />}
      {route.page === 'inbox' && <XgInboxPage ... />}
      {route.page === 'memory' && <XgMemoryPage ... />}
      {route.page === 'reviews' && <XgReviewsPage ... />}
    </XgProjectProvider>
  </main>
</Pages>
```

`XgFlowPage` 内部：

```tsx
<XgProjectContextBar                  // sticky；含项目切换触发器
  project={project}
  scope={scope}
  stats={derivedStats}
  onCreateRequirement={...}
/>
<div className="xg-flow-grid">
  <XgFlowMain>
    <XgCommitmentStrip />
    <XgActivityStream />
  </XgFlowMain>
  <XgNowPanel />
</div>
```

原型把项目切换器放在顶层 Header 里，是为了让 1200px 画面里“当前项目”始终处在第一行；React 实现若不想让 Header 感知 xg 业务，可以把同一个 `XgProjectSwitcher` 下移到 sticky context bar 的左侧，视觉层级不变，只是少一行顶部空间。

子组件：

| 原型区块 | React 组件 | 数据 / 行为 |
| --- | --- | --- |
| 顶部项目切换 | `XgProjectSwitcher` | `Project[]`、当前项目、`onChange`；可放在 Header 或 sticky context bar，菜单加 `aria-current` |
| 承诺条 | `XgCommitmentStrip` | 需求按状态计数；点击 → requirements tab + 状态筛选 |
| 活动流 | `XgActivityStream` + `XgActivityDay` | `ActivityEvent[]`，日分组，事件类型 mapping |
| 此刻 | `XgNowPanel` | `NowItem[]`、`runningTasks`、`nextItems`、`inboxCount` |
| 需求分组 | `XgRequirementGroups` + `XgRequirementRow` + `XgMiniTask` | `/requirements` 数据；展开状态本地 |
| 新建 / 拆任务 | `XgComposer` (`Sheet`) | `mode`, `requirement`, `onSubmit`；复用 `/requirements`、`/requirements/:id/split` |
| 任务详情 | `XgTaskSheet` + `XgTaskTimeline` | `useTaskDetail(id)`；`attempts + artifacts + reviews + events` 合并 |
| 删除确认 | `XgDeleteDialog` | 复用现有 `Modal` 或 `window.confirm` 替换为受控对话框 |
| 搜索 | `XgGlobalSearch` | 可复用现有 header 搜索；增加需求/任务/记忆结果分组 |

### API 映射

已有接口可直接支撑：

- `GET /projects`
- `GET /requirements?projectId=`
- `GET /tasks?projectId=&status=`
- `GET /tasks/:id` → `XgTaskDetail`（attempts / artifacts / reviews / events）
- `POST /requirements`
- `POST /requirements/:id/confirm`
- `POST /requirements/:id/split`
- `POST /tasks/:id/dispatch`
- `POST /tasks/:id/retry`
- `POST /tasks/:id/accept`
- `POST /tasks/:id/review`
- `POST /tasks/:id/delete`
- `POST /inbox/:id/triage`
- `POST /inbox/:id/ignore`
- `POST /memory/:id/confirm`
- `POST /memory/:id/reject`

时间线建议新增**读模型**，而不是前端从 5 个接口拼接：

```http
GET /activity?projectId=<id>&cursor=<iso>&limit=50
→ { items: ActivityEvent[], nextCursor: string | null }
```

如果暂时不加端点，至少把事件合并放在 service 层（服务端），避免：

- 同一次任务更新在 requirement、task、review 三个查询里生成三条重复事件；
- 客户端时区与排序不一致；
- 分页时事件被截断。

`ActivityEvent` 建议字段：

```ts
interface ActivityEvent {
  id: string
  kind: 'requirement' | 'split' | 'confirm' | 'attempt' | 'report' | 'evidence' | 'review' | 'accept' | 'inbox'
  projectId: string
  requirementId?: string
  taskId?: string
  inboxId?: string
  actor: string
  title: string
  detail?: string
  tone?: 'blue' | 'green' | 'amber' | 'red' | 'ink' | 'gray'
  attention?: boolean
  at: string
}
```

`NowItem` 是纯派生 selector：

```ts
const nowItems = [
  ...blockedTasks.map(toNowItem),
  ...pendingRequirements.sort(byPriority),
  ...reviewTasks.map(toNowItem),
  ...acceptTasks.map(toNowItem),
  ...pendingMemories.map(toNowItem),
].slice(0, 8)
```

### 上下文提升

当前 `XgRequirementsPage` 自己持有 `projectId`。建议：

- 在 `XgRoot` 或 `XgPanel` 内增加 `XgProjectProvider`（`projectId`, `setProjectId`, `projects`, `stats`）；
- 以 `sessionStorage` 或 URL query 保存最近项目，刷新后仍在同一项目；
- 需求页的“全部项目”是一个局部透视图，不再与顶部当前项目争夺“第一层上下文”；
- `app.tsx` 的 `TABS` 顺序保持 `概览 / 项目 / 需求 / 任务 / 收件箱 / 记忆 / 评审`，不增加同级导航。

### CSS 映射

- 复用 `client.css` 的 `dt-*` 原语（`dt-btn`, `dt-tag`, `dt-state-dot`, `dt-modal`, `dt-input`）。
- 本原型的颜色在 React 中应映射回 `--dsw-alias-*`：
  - `--accent → --dsw-alias-brand-primary`
  - `--green → --dsw-alias-state-success-primary`
  - `--amber → --dsw-alias-state-warn-primary`
  - `--red → --dsw-alias-state-error-primary`
  - `--faint → --dsw-alias-label-caption`
- 新增 `xg-flow.css`，只在 xg scope 生效，避免影响通用 panel 的 960px 列宽。
- 时间线横跨 `minmax(0,1fr) + 326px`；在 960px 以下右栏移到流上方，窄屏不要求完整多栏体验。

---

## 10. 如何降低认知负荷

1. **一个项目，一个镜头。** sticky 条和项目切换器把“我在哪里”从记忆里搬到界面上；切项目时右上角范围自动回到当前项目。
2. **一条时间线，而不是五张表。** 承诺、执行、评审共享时间顺序，日期是天然的分段；不需要在需求、任务、评审之间来回对照。
3. **把“变化”与“待办”分开。** 时间线回答“发生了什么”，右栏回答“现在要我做什么”。右栏只收需要判断的事；收件箱只留一个汇总入口。
4. **渐进展开，而不是隐藏状态。** 需求折叠时仍显示任务数、状态点与阻塞信号；展开才看到来源、任务与最新尝试；完整 attempts 只在任务 sheet。
5. **动作在状态旁边。** 待确认需求旁是“确认”，评审任务是“评审”，待验收是“验收”；用户不需要先打开详情再找按钮。
6. **视觉权重分层。** 普通报告用细线和灰字退后；阻塞/失败用红点、红 chip 和 attention 文案跳出来。完成不是重点，承诺的推进才是。
7. **原文保留。** 收件与需求里的客户原话不被改写；分诊时先保留语境，再决定项目与标题，减少“翻译损失”。
8. **可预期的反馈。** 确认、拆任务、评审、验收、删除都有即时 toast、状态变化和时间线事件；用户不会不知道自己刚刚改变了什么。
9. **搜索是逃生口。** 需求/任务/记忆都能从全局搜索直接跳转，避免在分组里迷路。
10. **低数据也不空。** 空状态告诉用户下一步（“这个状态下没有需求”“当前没有进行中的尝试”），而不是留一张空表。

---

## 11. 边界与取舍

- **原型时钟**：固定在 `2026-11-17 14:32`，后续操作递增；真实产品必须使用服务端时间，且按用户时区显示。
- **数据合并**：任务详情目前从 attempts、artifacts、reviews、任务 acceptedAt 归并；若服务端已有 `events` 表，应优先使用规范化事件并在服务端去重。
- **分页**：原型一次展示三天全部事件。真实实现应按游标分页、按天折叠，首屏最多渲染最近 50 条；`全部项目` 视图分页参数必须包含项目集合。
- **性能**：`nowItems` 是 O(当前项目的需求 + 任务 + 记忆)，量级很小；活动流可以虚拟化，但不应在客户端无限累积历史。
- **权限 / 敏感级**：原型把 `内部/机密` 放在上下文与项目卡上；真实实现中机密项目的活动、记忆、收件需要按权限裁剪，不能只在视觉上隐藏。
- **多窗口**：sheet 不改变 URL；如果希望任务链接可分享，应把 `detailTaskId` 映射到 route（如 `tasks/:id`），原型保留 sheet 是为了维持流上下文。
- **删除语义**：删除任务只从列表与统计中移除；attempts、artifacts、reviews、audit 仍保留。需求关闭同理，不删历史。
- **自动派发**：任务详情显示自动派发状态；原型未实现项目设置面板，真实实现应把开关放在项目设置，而不是任务上。

---

## 12. 原型验收清单

- 七个 tab 全部可点击：概览 / 项目 / 需求 / 任务 / 收件箱 / 记忆 / 评审；
- 项目切换器：DEMO ↔ NEW_CENTER_APP；上下文条、指标、时间线、右栏、收件箱数量同步；
- 需求页：项目分组 + 状态分组；展开需求看到任务与最新尝试；
- 新建需求：slide-over，表单校验，创建后进入需求页并高亮；
- 收件转需求：保留原话，提交后收件减少；
- 拆任务：slide-over，实时预览，句号/“以及”提示，提交后任务出现在需求下；
- 任务详情：右侧 sheet，attempts / reports / 证据 / 评审 / 验收时间线；
- 评审：通过 → 待验收，退回 → 进行中；写入时间线和右栏；
- 验收：待验收 → 完成；写入时间线与右栏；
- 阻塞：重试派发 → 新 attempt 与进行中状态；
- 删除：确认对话框，删除后从任务列表消失，底层记录保留；
- 记忆：确认 / 退回；
- 搜索：需求、任务、记忆跳转；
- 时间线：事件类型、日分组、过滤、当前项目 / 全部项目、打开需求/任务/收件；
- `Esc` 关闭最上层；`⌘K / Ctrl+K` 搜索；
- 1200px 桌面下无横向溢出；不需要真实后端。

---

## 13. 文件

```text
docs/v1/ui-design/proposals/05-timeline-flow/
  index.html   # 自包含原型（HTML + CSS + vanilla JS，无外部资源）
  notes.md     # 本文
```
