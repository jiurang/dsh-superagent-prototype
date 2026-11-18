# 最终态层级与设置归属

## 1. 为什么必须分三层

雄大可以有很多项目，而 dsh-superagent 的运行配置是实例级的：

- 模型服务商、密钥、stateDir、端口、备份是**整个实例共享**的；
- 项目根目录、敏感级别、Worker 模型覆盖是**项目独有**的；
- 任务类型、优先级、验收标准是**单次任务**的。

把三者放进同一个表单，会让“修改一个项目”误改所有项目。

## 2. 系统级设置

| 配置 | 存储 | 说明 |
|---|---|---|
| 模型服务商 / 模型 / 推理强度 | dsh-superagent settings | 来自 DSH `GET models` catalog；默认模型对所有项目生效 |
| 来源 GitHub / 飞书 / 本地 | `settings.sources` + `SourceRegistry` | 连接器和凭据属于实例；本地模式只需本地根目录 |
| stateDir、端口、备份 | profile / machine settings | 实例基础设施 |
| 全局并发 `maxWorkers` | `settings.executor` | 当前仍是实例级 |
| 提示词、部署账号 | dsh-superagent settings | 实例级 |

UI：设置页左侧「系统设置 · 影响本实例所有项目」。

## 3. 项目级设置

存储在 `xg_project_settings`，与 `xg_projects` 一对一：

| 字段 | 作用 |
|---|---|
| `root_path` | Worker 直接工作的项目根目录；空则用本地来源根目录 |
| `sensitivity` | 公开 / 内部 / 机密，决定工具网关阻断或脱敏 |
| `default_priority` | 需求没有优先级时，拆任务的默认优先级 |
| `auto_dispatch` | 新任务是否默认自动派发 |
| `worker_provider` / `worker_model` / `worker_effort` | 项目 Worker 模型覆盖；空则继承系统执行器模型 |

UI：设置页左侧「项目设置 · 只影响所选项目」，带项目选择器。

## 4. 任务级

`xg_tasks` 保存类型、优先级、验收标准；`xg_attempts` 保存每次执行尝试。任务级不再重复保存项目/系统设置。

## 5. 有效配置解析

```text
effective(task) = systemDefaults
                  ⊕ projectSettings(task.projectId)
                  ⊕ taskOverrides(task)
```

目前落地：

- `root_path` / 项目根目录：任务派发时解析，用于 Worker 工作目录；
- `worker_model`：创建该项目的 Worker Session 时覆盖系统执行器模型；
- `auto_dispatch`：`createTask` 未显式指定时取项目默认值；
- `default_priority`：需求未定优先级时，拆任务表单使用项目默认值；
- `sensitivity`：工具网关按项目读取。

## 6. UI 层级

```text
设置
├─ 系统设置 · 影响本实例所有项目
│  ├─ 来源
│  ├─ 评估
│  ├─ 执行
│  ├─ 提示词
│  └─ 部署
└─ 项目设置 · 只影响所选项目
   └─ 项目选择器 + 项目级表单
```

浏览器截图见 `evidence/project-settings.jpeg`。

## 7. 业务页界面结构

需求、任务、项目、收件箱、记忆、评审六个页面使用同一套工作台语言，差异只在业务对象：

| 页面 | 结构 | 主操作 |
|---|---|---|
| 项目 | 系统/项目边界条 + 项目身份卡网格 + 新建项目 composer | 新建项目、打开项目设置 |
| 需求 | 项目栏 + 状态筛选 + 列表/看板 + 常驻详情 | 确认需求、拆任务、新建需求 |
| 任务 | 项目栏 + 状态筛选 + 列表/看板 + 常驻详情 | 派发、重试、评审、验收、删除 |
| 收件箱 | 未处理列表 + 常驻详情 | 记录收件、转需求、忽略 |
| 记忆 | 项目筛选 + 搜索 + 列表 + 常驻详情 | 新建记忆、确认、退回、检查引用 |
| 评审 | 统计卡 + 决策筛选 + 时间线 | 查看评审意见（只读） |

共同规则：

- 项目是业务页的第一层上下文，项目栏固定显示短码、名称、状态、敏感级和根路径；
- 列表是脊柱，详情独立滚动；Attempt、证据、评审只在任务详情出现；
- 动作贴近对象，不集中堆在页面底部；
- 列表/看板切换保留当前选中对象；看板卡片只做摘要，不隐藏阻塞、失败、优先级；
- 系统级信息只在项目页边界条和「设置 → 系统设置」出现，项目级信息在项目栏和「设置 → 项目设置」。

实现：`src/client/xg/panel.tsx`、`src/client/xg/xg.css`；设计依据见 `ui-design/final-synthesis.md` 与 `ui-design/scoring-table.md`。

## 8. 已知边界

- GitHub 连接器仍是“一个实例一个仓库”，这是上游 Super-agent 的单仓库限制；本地模式支持一个实例内多个本地项目。
- 全局 `maxWorkers` 仍是实例级；项目级并发上限暂未拆出。
- 提示词仍是实例级；项目级提示词覆盖未实现。
- 项目 Worker 模型只影响新建 Worker Session，不追溯正在运行的 Session。
