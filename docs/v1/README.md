# 雄大工作台 v1 · 最终态文档

本目录记录雄大工作台 v1 的最终态设计、浏览器验收案例、测试过程与测试结果。实现不按阶段拆分；系统级、项目级、任务级三层从第一版就分开。

## 目录

- [design.md](design.md)：最终态层级与设置归属
- [test-cases.md](test-cases.md)：验收案例
- [test-process.md](test-process.md)：浏览器测试过程与命令
- [test-results.md](test-results.md)：结果、证据与已知边界
- [ui-design/](ui-design/)：5 份 UI 原型、8 份评分、前三名与最终合成设计
- [evidence/](evidence/)：浏览器截图（`ui-*.png` 为本轮重构后界面；索引见 [evidence/README.md](evidence/README.md)）

## 工作台界面

界面采用“项目上下文 + 母版列表 + 常驻详情”的工作台结构，而不是纵向堆叠的表单：

```text
项目栏：短码 / 名称 / 状态 / 敏感级 / 根路径 / 项目级计数 / 项目切换
  ├─ 需求：状态筛选 + 列表或看板 + 右侧详情（来源、验收、任务构成、确认、拆分）
  ├─ 任务：状态筛选 + 列表或看板 + 右侧详情（需求、验收、规格、Attempt、证据、评审、动作）
  ├─ 项目：项目身份卡 + 系统级 / 项目级边界
  ├─ 收件箱：未处理列表 + 转需求详情
  ├─ 记忆：跨项目检索 + 详情（确认 / 退回）
  └─ 评审：统计 + 决策时间线
```

设计依据与评审过程见 [ui-design/README.md](ui-design/README.md) 和 [ui-design/scoring-table.md](ui-design/scoring-table.md)。


## 三层设置

```text
系统级（dsh-superagent 实例）
  ├─ 模型服务商 / 密钥 / 默认模型
  ├─ 来源连接器（GitHub / 飞书 / 本地）
  ├─ stateDir / 端口 / 备份 / 全局并发
  └─ 提示词 / 部署账号

项目级（xg_projects + xg_project_settings）
  ├─ root_path
  ├─ 敏感级别
  ├─ 默认优先级
  ├─ 新任务默认自动派发
  └─ 项目 Worker 模型覆盖

任务级（xg_tasks / xg_attempts）
  ├─ 设计 / 开发 / 排障 / 评审
  ├─ 优先级、验收标准
  └─ 执行尝试、证据、评审、记忆
```

原则：**系统设置属于实例，不随项目变化；项目设置只影响所选项目；任务级只覆盖一次执行。** 面板「设置」左侧明确分成「系统设置」和「项目设置」两个作用域。
