# 测试结果

## 1. 命令结果

| 命令 | 结果 |
|---|---|
| `pnpm test:xg` | **10 文件 / 62 用例通过** |
| `pnpm exec tsc --noEmit` | exit 0 |
| `pnpm build` | 构建完成（`lib/`，client 与 ESM 入口均产出） |
| `pnpm exec vitest run tests/panel-settings.spec.tsx tests/docs.spec.ts` | 12 用例通过 |

## 2. 验收结论

| 案例组 | 结果 | 证据 |
|---|---|---|
| H1–H2 设置作用域 | ✅ | `evidence/project-settings.jpeg`：左侧「系统设置」与「项目设置」分组；系统组提示“不随单个项目改变” |
| H3–H4 项目设置 | ✅ | 选择 `NEW_CENTER_APP`，root_path `G:\Projects\center-app`；保存后 API `settings.updatedAt` 更新，系统设置未改 |
| H5–H6 模型目录 | ✅ | 项目 Worker 模型/服务商下拉框由 DSH `GET models` catalog 驱动；留空继承系统默认 |
| P1–P2 主 Session 感知 | ✅ | `evidence/session-perception.jpeg`：Session 调用 `xg.project.list`、`xg.task.list`，回答 2 个项目、ID、根路径 |
| P3 Worker 感知 | ✅ | `xg-tools.spec.ts`：Worker 任务提示、`xg.task.get/report/artifact.add/triage.record/memory.*` |
| P4 已删除任务 | ✅ | Session 调用 `xg.task.get('DEMO-5')` 得到“任务已删除：DEMO-5” |
| D1–D5 任务删除 | ✅ | 面板任务详情显示删除；API 软删除、审计、迁移测试；活动 Ticket 停止由 service test 覆盖 |
| L1–L2 本地模式 | ✅ | 独立 profile 实测：账户 `local`，Worker 在项目根目录写出 `hello.txt` |
| L3–L4 任务拆分 | ✅ | `taskTitlesFromInput` 测试：一句话中的逗号不拆，换行才拆 |
| U1–U6 需求/任务新界面 | ✅ | `ui-requirements.png`、`ui-requirements-board.png`、`ui-tasks.png`、`ui-tasks-board.png`；项目栏、列表/看板、详情均为真实 UI |
| U4–U5 新建/确认/拆分 | ✅ | 浏览器真实操作创建需求、确认、拆出 3 个任务；列表、计数、任务构成同步更新 |
| U6–U8 任务详情/删除 | ✅ | `ui-task-detail.png`、`ui-task-delete.png`；详情顶部显示任务状态，删除确认后行消失 |
| U9 项目页 | ✅ | `ui-projects.png`；两张项目身份卡与系统/项目边界条 |
| U10 收件箱 | ✅ | `ui-inbox.png`；记录两条收件，其中一条转需求后从未处理列表消失 |
| U11 记忆 | ✅ | `ui-memory.png`；新建并关联证据产物后确认，确认按钮不再出现 |
| U12 评审 | ✅ | `ui-reviews.png`；统计与时间线空状态正常 |
| U13 控制台 | ✅ | 本轮 CDP 监听未捕获 `Runtime.exceptionThrown` 或 `console.error` |
| U14 项目卡进入设置 | ✅ | 点击 `NEW_CENTER_APP` 卡片的「项目设置」，设置页默认选中 `NEW_CENTER_APP · 中心应用` |

## 3. 浏览器证据

- `evidence/ui-projects.png`：项目身份卡 + 系统级/项目级边界（1440×1040 窗口 / 1416×948 视口）。
- `evidence/ui-requirements.png`：项目栏、状态分组、母版-详情。
- `evidence/ui-requirements-board.png`：需求看板 4 列与选中卡片。
- `evidence/ui-requirement-create.png`：右侧新建需求 composer。
- `evidence/ui-tasks.png`：任务母版列表与空详情。
- `evidence/ui-tasks-board.png`：任务看板按状态分列。
- `evidence/ui-task-detail.png`：任务标题、需求、验收、操作、产物。
- `evidence/ui-task-delete.png`：删除任务后的列表。
- `evidence/ui-inbox.png`：收件列表 + 转需求详情。
- `evidence/ui-memory.png`：记忆详情与已确认状态。
- `evidence/ui-reviews.png`：评审统计与空状态。
- `evidence/ui-final-prototype.png`：最终合成原型 `00-final`。
- 旧功能证据：`evidence/project-settings.jpeg`、`evidence/session-perception.jpeg`。

## 4. 测试数据

- 需求页新增 `账单筛选与导出优化`、`消息通知延迟排查`、`月度对账单口径确认`，以及收件箱转出的需求；保留为演示数据。
- 任务新增 `DEMO-6`、`DEMO-7`、`DEMO-8`、`DEMO-9`、`DEMO-10`；其中 `DEMO-8`、`DEMO-10` 已软删除。
- 记忆 `账单导出字段口径` 已确认，关联证据产物 `ART_DEMO_EXPORT_CHECK`（验收夹具）。
- 收件箱保留一条未处理收件「财务同事 · 王琳」。
- 未删除用户原有项目/需求。

## 5. 已知边界

1. GitHub 连接器仍是“一个实例一个仓库”（上游单仓库限制）；本地模式支持一个实例内多个项目。
2. 全局 `maxWorkers` 仍是实例级，项目级并发上限尚未拆出。
3. 提示词仍是实例级，项目级提示词覆盖尚未实现。
4. 项目 Worker 模型只影响新建 Worker Session，不追溯运行中的 Session。
5. 任务看板 7 列在 1280px 内容宽度下需要横向滚动；默认仍是列表视图。
6. 评审页当前无真实评审记录，显示空状态；评审通过/退回状态机由 `xg-service.spec.ts` 覆盖，尚未在浏览器里制造真实 Worker 评审。
7. 记忆新建必须关联证据产物；无产物时表单会阻止保存并提示，这是刻意的证据约束。

