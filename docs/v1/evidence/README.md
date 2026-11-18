# 浏览器证据索引

工作台界面重构后的截图，统一在 Edge headless **1440×1040 窗口**下截取，实际页面视口为 **1416×948**（DSH 侧栏与滚动条占余下宽度）。截图不是设计稿，而是实际运行实例的页面。

| 截图 | 页面 | 验收点 |
|---|---|---|
| [ui-projects.png](ui-projects.png) | 项目 | 项目身份卡、系统级/项目级边界、根路径与状态 |
| [ui-requirements.png](ui-requirements.png) | 需求 | 项目栏、状态分组、母版列表、右侧详情、任务构成 |
| [ui-requirements-board.png](ui-requirements-board.png) | 需求 · 看板 | 4 个状态列、卡片优先级/来源/任务进度、选中卡片 |
| [ui-requirement-create.png](ui-requirement-create.png) | 需求 · 新建 | 右侧 composer，不再使用页面底部大表单 |
| [ui-tasks.png](ui-tasks.png) | 任务 | 项目栏、任务列表、右侧详情空态 |
| [ui-tasks-board.png](ui-tasks-board.png) | 任务 · 看板 | 按状态分列、卡片 ID/优先级/类型、详情仍可打开 |
| [ui-task-detail.png](ui-task-detail.png) | 任务详情 | 任务标题/状态、需求、验收、操作、运行记录、产物 |
| [ui-task-delete.png](ui-task-delete.png) | 任务删除 | 删除确认后任务从列表消失 |
| [ui-inbox.png](ui-inbox.png) | 收件箱 | 未处理列表、原话引用、转需求/忽略 |
| [ui-memory.png](ui-memory.png) | 记忆 | 已确认状态、来源、标签、证据约束 |
| [ui-reviews.png](ui-reviews.png) | 评审 | 统计卡、决策筛选、空状态 |
| [ui-final-prototype.png](ui-final-prototype.png) | 合成原型 | `docs/v1/ui-design/proposals/00-final/index.html` |

旧功能证据：

- [project-settings.jpeg](project-settings.jpeg)：系统/项目两级设置。
- [session-perception.jpeg](session-perception.jpeg)：主 Session 调用 `xg.project.list` / `xg.task.list`。

## 捕获方式

由于本轮环境没有 browser 工具，使用 Edge headless + DevTools Protocol：

```powershell
msedge.exe --headless=new --disable-gpu --hide-scrollbars `
  --remote-debugging-port=9222 --window-size=1440,1040 `
  --user-data-dir=<temp-profile>
```

再通过 CDP 打开带 token 的 `http://127.0.0.1:3182/?token=...`，点击侧栏「雄大工作台」，用 `Runtime.evaluate` 操作 tab/行/表单，用 `Page.captureScreenshot` 保存。测试过程见 [../test-process.md](../test-process.md) 第 7 节。
