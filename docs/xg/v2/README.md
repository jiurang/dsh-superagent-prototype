# 雄大工作台 v2 · DSH 集成

原型：[prototype/index.html](prototype/index.html)。单文件，无依赖，直接双击即可；它是早期的三栏方向稿，**不是运行版**。运行版已经把导航移进 DSH 侧栏，并统一到 DSH 视觉。

## 已完成（2026-11-18）

- **导航进 DSH 侧栏**：今天 / 工作 / 收件 / 知识四个主面板直接注册为 DSH 侧栏条目；工作台自己的品牌、用户、设置和 190px 导航栏已删除。
- **统一视觉**：面板改用 DSH design tokens（背景、边框、文字、状态色、按钮）；右侧 Agent 栏已删除，Agent 走 DSH 原生会话（「新委托」「问 Agent」「打开主 Session」都会打开主 Session）。
- **真实数据**：`GET /xg/api/workbench` 一次返回项目、需求、任务、收件、记忆、提案、评审和审计。
- **真实动作**：需求确认/拆解/删除、任务派发/重试/取消/验收/删除、收件转需求/忽略/删除、记忆确认/退回、引用检查。
- **Agent 提案 / diff**：主控通过 `xg.proposal.create` 提交需求拆解提案；今天和需求文档显示 diff，人点「应用」才落库；目标变了会过期。
- **无用数据出口**：需求、任务、收件都有软删除；需求下还有未取消任务时先提示处理任务。
- **设置迁移**：「工作台设置」现在直接包含来源、评估、执行、提示词、部署、项目和诊断；旧版入口、`?legacy=1`、旧 App 和旧面板测试已彻底删除。upstream 同步改为 cherry-pick。
- **跨面板导航**：今天里的「查看」会打开工作文档；「分诊」会打开收件详情；状态在面板切换间保留。
- **工作项详情降噪**：标题/状态 sticky；空 section 折叠；证据只显示标题、类型、时间，正文按需展开；Attempt、原始 ID、审计进「诊断」；事件标签人话化。
- **空间**：工作区最大宽度 850 → 960px，文档 760 → 900px；DSH 侧栏底部显示「需要你 N」总数入口，点击打开今天。

## 待解决

剩余问题、优先级和验收标准见 [remaining-issues.md](remaining-issues.md)。最大的三项是：

1. 运行状态页：Source 健康、Trigger、Eval、Execution 没有独立页面，诊断只保留运行状态和审计。
2. 评审提交、模型凭据、移动端、设置表单视觉和 v2 UI 测试。

## 结构

- 入口：`src/client/index.tsx` 注册四个主面板和四个 DSH 侧栏条目。
- UI：`src/client/xg/v2/Workbench.tsx`、`workbench.css`。
- 设置：`src/client/xg/v2/SettingsPanel.tsx`，复用旧设置表单并加诊断。
- 跨面板状态：`src/client/xg/v2/navigation.ts`。
- Agent：走 DSH 原生会话；面板不再有右侧聊天栏。
- 数据：`src/xg/api-contract.ts`、`src/xg/http.ts` 的 `GET /workbench`。

## 原型

原型仍保留早期三栏布局，用来对比信息架构：

- 今天：注意力队列。
- 工作：项目分组 + 文档式详情。
- 收件 / 知识 / 设置：分类在各功能页内。
- 建议点击顺序和早期说明见文件内注释；运行版的差异以本页为准。
