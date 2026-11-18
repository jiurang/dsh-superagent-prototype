# 上游改动清单（rebase 用）

本仓库 fork 自 `deepseek-ai/dsh-superagent-prototype`。业务代码全部在 `src/xg/`、`src/client/xg/`、`tests/xg-*`、`docs/xg/`；上游文件只保留以下注册/钩子改动。

## 上游文件改动

| 文件 | 改动 | 目的 |
|---|---|---|
| `README.md` | 增加「雄大工作台」说明与文档入口 | 本 fork 的定位；内部前缀仍为 `xg` |
| `cordis.patch.yml` | 两个自定义预设显示名改为「雄大 · 执行器」「雄大 · 主 Session」 | 品牌名；预设 ID 不变 |
| `package.json` | `typecheck` 改为 `pnpm exec tsc --noEmit` | Windows 下 `.ps1` 执行策略可能阻止直接调用 `tsc` |
| `src/core/engine.ts` | 新增 `authorizeTicket(trigger, outcome)` | 让宿主已授权的 xg 任务绕过 GitHub/飞书来源准入，直接创建 Ticket |
| `src/core/evals.ts` | 新增 `Evals.authorize` | 实现 `authorizeTicket`：保存 Trigger、写入显式 `followup` 授权依据、复用 `accept` 创建 Ticket |
| `src/app/runtime.ts` | 引入 `XgRuntime` 与 `XgPolicy`；注册 `xg` 字段；在 Session 工具列表追加 `xg.*`；启动/停止 xg；注册 `/xg/api` | 单体组合根接入 |
| `src/app/sessions.ts` | Session 宿主接口新增可选 `xgPrompt`，主 Session 与 Worker 都追加工作台提示；使用 router preset 的新建 Session 也按主 Session 处理；主 Session 的 restrict 只列实际注册的 shell 工具（bash/pwsh） | 让智能体感知工作台；同时支持 Windows 的 pwsh profile |
| `src/app/setup.ts` | `SetupHost` 新增 `localRoot`；无 GitHub 仓库且有本地来源时解析本地 deployment，跳过 GitHub/gh 校验 | 本地模式，不再强制 GitHub |
| `src/deployment.ts` | `SETUP_FIELDS` 增加 `local.rootPath`；`stateDir` 接受 Windows 盘符绝对路径 | 本地模式切换；Windows 上 DSH workspace 需要 `C:/...` |
| `src/executor/dsh.ts` | `ticketExecution` 支持目录覆盖；`ExecutorHost` 增加 `executionRootFor`/`localWorkspace`；本地 Ticket 直接在项目根目录工作，跳过 worktree prepare/verify | xg Worker 使用本地项目目录 |
| `src/infra/environment.ts` | `writeEnvironment` 增加 `{local:true}`：不写 GitHub credential helper，`gh` shim 直接失败 | 本地模式无 GitHub 凭据 |
| `src/index.ts` | `export * from './xg/index.ts'` | 库入口导出 xg 类型/服务 |
| `src/client/app.tsx` | 导入并渲染 6 个 xg 页面；业务页使用 `xg-wide` 容器 | 现有面板加业务标签页；工作台有足够宽度承载母版-详情 |
| `src/client/index.tsx` | 注册今天/工作/收件/知识四个主面板与 DSH 侧栏条目；设置走面板顶部按钮；legacy 分支和 `?legacy=1` 已删除 | 导航进 DSH 侧栏，不再保留第二套工作台外壳 |
| `src/client/settings-kit.tsx` | `ModelField` 的 provider/model/effort 改为由 `GET models` catalog 驱动的下拉框；选 provider 自动选第一个 model | 服务商下拉框正确关联 DSH 模型目录 |
| `src/client/settings.tsx` | 设置页分成「系统设置」与「项目设置」两个明确作用域；项目设置只影响所选项目 | 层级结构在 UI 上严谨体现 |
| `src/client/client.css` | 设置导航增加作用域标题样式 | 系统/项目两级视觉分隔 |
| `src/client/route.ts` | `TABS` 增加 projects/requirements/tasks/inbox/memory/reviews；`Route` 与 `parseRoute` 增加对应页面 | 路由 |
| `src/client/locales.ts` | 增加 `tab.projects` 等 6 个中英文标签，以及 `panelToday/panelWork/panelInbox/panelKnowledge` 四个侧栏标签 | 中文界面 |
| `tests/panel-panel.spec.tsx` | 标签页期望值加入 6 个新标签 | 跟随界面变化 |
| `tests/controls.spec.tsx` | 扫描 `src/client` 时跳过子目录 | 支持 `src/client/xg/` |
| `tests/panel-settings.spec.tsx` | 模型字段测试改用下拉框，并断言服务商选项来自模型目录 | 跟随 UI 修复 |
| `tests/model-surface.spec.ts` | Worker 工具清单加入 `xg.*`；orchestrator 预算 64,000（含工作台提示），worker 42,500 | 跟随新增工具面 |
| `tests/panel-overview.spec.tsx` | 标签页期望值加入 6 个新标签 | 跟随界面变化 |
| `tests/runtime.spec.ts`, `tests/fixtures/host.ts` | 假 Web 服务器只把 `/orchestrator` 注册记为 `api()` 的目标，忽略 `/xg` | 支持同一进程两个 HTTP 前缀 |
| `tests/client.spec.tsx` | 侧栏标签期望值改为「雄大工作台」 | 品牌名 |
| `tests/docs.spec.ts` | 文档表格/链接检查按 `/` 归一化，读取时去掉 CRLF | 让文档测试在 Windows 通过；不改变测试意图 |
| `tests/styles.spec.ts` | CSS 类扫描改为递归读取 `src/client` | 识别迁到 `src/client/xg/v2/settings/` 的设置组件 |
| `docs/007-architecture.md` | Modules/Tests 表加入 xg 文件与测试 | 文档完整性检查 |

## 已删除的上游文件（hard fork，2026-11-18）

v2 接管 UI 后，旧面板外壳、旧状态页和旧面板测试全部删除。以下删除是有意为之；如果以后选择继续同步 upstream，不要恢复：

```text
src/client/app.tsx
src/client/overview.tsx
src/client/settings.tsx
src/client/thread.tsx
src/client/ticket.tsx
src/client/trigger.tsx
src/client/source.tsx
src/client/eval.tsx
src/client/execution.tsx
src/client/rows.tsx
src/client/marks.ts
src/client/xg/panel.tsx
src/client/xg/xg.css
tests/fixtures/panel.tsx
tests/fixtures/panel-server.ts
tests/panel-deployment.spec.tsx
tests/panel-eval.spec.tsx
tests/panel-execution.spec.tsx
tests/panel-overview.spec.tsx
tests/panel-panel.spec.tsx
tests/panel-prompts.spec.tsx
tests/panel-settings.spec.tsx
tests/panel-source.spec.tsx
tests/panel-trigger.spec.tsx
tests/marks.spec.ts
tests/xg-panel.spec.tsx
```

保留的共享组件：`controls`、`draft`、`settings-kit`、`widgets`、`provider`、`api`、`text`、`locales`、`client.css`、`deployment`、`project-settings`、`prompts`，以及 v2 `SettingsPanel` 直接使用的 `source/eval/execution` 设置部分（已迁到 `src/client/xg/v2/settings/`）。

**同步方式已改为 cherry-pick，不再 rebase**：`git fetch upstream` 后只挑 `src/core`、`src/app`、`src/executor` 等需要的提交；`src/client` 的上游 UI 提交直接忽略。

## 新增文件

```text
src/xg/
  domain.ts ids.ts schema.ts store.ts policy.ts email.ts service.ts tools.ts http.ts api-contract.ts runtime.ts index.ts local.ts
src/client/xg/
  client.ts panel.tsx project-settings.tsx xg.css
  v2/ Workbench.tsx SettingsPanel.tsx SidebarBadge.tsx workbench.css navigation.ts
docs/v1/ui-design/
  README.md scoring-guide.md scoring-plan.md scoring-table.md final-synthesis.md
  proposals/01-command-center … 05-timeline-flow, proposals/00-final
  scores/agent-01.md … agent-08.md
tests/
  xg-acceptance.spec.ts xg-service.spec.ts xg-dispatch.spec.ts xg-policy.spec.ts xg-email.spec.ts xg-http.spec.ts
  xg-panel.spec.tsx xg-tools.spec.ts xg-local.spec.ts xg-upstream.spec.ts
docs/xg/
  acceptance.md acceptance-report.md upstream-changes.md operations.md opencode-test.md
  v2/ README.md remaining-issues.md prototype/index.html
```

## 与 upstream 同步（不再 rebase）

产品线已经 hard fork；upstream 只作参考：

1. `git fetch upstream`。
2. 只挑需要的提交，例如 `git cherry-pick <sha>`；不要 `git rebase upstream/main`。
3. `src/client` 的上游 UI 提交直接忽略；`src/core`、`src/app`、`src/executor` 的修复按需挑。
4. 先跑上游相关测试；Windows 上 `service-script`、`environment`、`sources` 等依赖 `sleep`/`tmux`/`sh` 的用例会失败，属基线问题。
5. 跑 `pnpm exec vitest run tests/xg-*.spec.ts`、`pnpm exec tsc --noEmit`、`pnpm build`。
6. 若上游改了以下接口，按顺序修复：
   - `Engine` 的 `evals`/`tickets` 构造与 `Evals.accept` 签名；
   - `Runtime` 的 `tools:` 回调与 `initialize`/`shutdown`；
   - `Route` 联合类型与 `TABS`；
   - `SettingsSchema`（默认 Policy 不能加 xg source，避免破坏上游精确断言）。
5. xg schema 只加表/列，不改上游 `kv` schema；`XG_SCHEMA_VERSION` 独立。

## 不修改上游的边界

- 不给 `SettingsSchema` 增加默认 `xg` policy source；xg 授权走 `Engine.authorizeTicket`，不伪装成 GitHub/飞书发送人。
- 不改上游 `cordis.patch.yml`；xg 不是独立 Cordis 插件，而是 `dsh-superagent` 进程内的业务层。
- 不改上游 Agent preset；`xg.*` 工具按 Session 动态注册，不进入全局工具表。
- 不改上游数据库迁移；`migrateXg` 只创建 `xg_*`。
