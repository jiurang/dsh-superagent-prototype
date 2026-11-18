# 测试过程

日期：2026-11-17 ~ 2026-11-18  
环境：Windows，Node 25.8.1，dsh-superagent profile `xg`，`http://127.0.0.1:3182`  
stateDir：`G:/tmp/xg-workbench-state`  
模式：local（无 GitHub）

## 1. 静态检查

```powershell
$node = "C:\Users\Administrator\AppData\Local\Author Software\nvm\installs\v25.8.1"
$env:PATH = "$node;$env:PATH"
& "$node\pnpm.cmd" test:xg
& "$node\pnpm.cmd" exec tsc --noEmit
& "$node\pnpm.cmd" build
```

## 2. 浏览器：设置层级

1. 打开 `http://127.0.0.1:3182/?token=...`；
2. 点击侧栏「雄大工作台」；
3. 点击顶部「设置」；
4. 确认左侧出现：
   - `系统设置 · 影响本实例所有项目`
   - 来源 / 评估 / 执行 / 提示词 / 部署
   - `项目设置 · 只影响所选项目`
   - 项目设置
5. 点击「来源」，确认提示“以下配置属于 dsh-superagent 实例，不随单个项目改变。”；
6. 点击「项目设置」，选择 `NEW_CENTER_APP · 中心应用`；
7. 确认 root_path 为 `G:\Projects\center-app`，敏感级别为「内部」；
8. 点击「保存项目设置」，页面出现「已保存」；
9. 调用 API 校验：

```text
GET /xg/api/projects/PRJ_c4366e4719ce/settings
→ project.rootPath = G:\Projects\center-app
→ settings.updatedAt 已更新
```

截图：`evidence/project-settings.jpeg`

## 3. 浏览器：Session 感知雄大

1. 在侧栏选择会话「查询雄大工作台项目任务」；
2. 输入：

```text
雄大工作台现在有哪些项目和任务？请直接调用 xg.project.list 和 xg.task.list 查询后回答。
```

3. 页面出现两次工具调用：

```text
xg.project.list · {}
xg.task.list · {"limit":50}
```

4. 模型回答：

```text
当前工作台有 2 个项目：
- 演示项目 · 账单系统  DEMO  活跃  内部
- 中心应用  NEW_CENTER_APP  活跃  内部
项目 ID：PRJ_5e742cb1189b、PRJ_c4366e4719ce
中心应用根路径：G:\Projects\center-app
```

5. 再问：

```text
现在再列一下任务，并指出 DEMO-5 是什么。
```

6. 模型调用 `xg.task.get('DEMO-5')`，回答“任务已删除：DEMO-5”，并说明 `xg.task.list` 不返回已删除任务。

截图：`evidence/session-perception.jpeg`

## 4. 任务删除

自动化：

```powershell
& "$node\pnpm.cmd" exec vitest run tests/xg-service.spec.ts tests/xg-http.spec.ts tests/xg-panel.spec.tsx
```

真实 API 测试（临时任务，测试后删除）：

```text
创建 DEMO-4 → POST /xg/api/tasks/DEMO-4/delete
→ deletedAt 写入
→ GET /xg/api/tasks 不再返回
→ GET /xg/api/tasks/DEMO-4 → 400 任务已删除
→ 审计出现“删除任务”
```

## 5. 本地模式实测

独立的 `xg-localtest` profile（port 3183）上：

```text
只配置 local 来源根目录
→ setup 通过，accounts.repository = local
→ 创建 LOC2 / LOC2-R1 / LOC2-1
→ 派发
→ Worker 在项目根目录写出 hello.txt
→ 任务从进行中进入评审
```

测试后停止临时实例并清理 profile/state。

## 7. 工作台界面重构验收（2026-11-18）

### 7.1 构建与启动

```powershell
$node = "C:\Users\Administrator\AppData\Local\Author Software\nvm\installs\v25.8.1"
$env:PATH = "$node;$env:PATH"
& "$node\pnpm.cmd" exec tsc --noEmit
& "$node\pnpm.cmd" test:xg
& "$node\pnpm.cmd" build
```

重启 `xg` profile 后，等待输出：

```text
dsh web: http://127.0.0.1:3182/?token=...
```

### 7.2 浏览器方式

本轮不再使用已移除的 browser 工具。改用 **Edge headless + DevTools Protocol**：

1. `msedge.exe --headless=new --remote-debugging-port=9222 --window-size=1440,1040`；
2. 通过 CDP 打开带 token 的地址；
3. 点击侧栏「雄大工作台」，进入 12 个标签页的面板；
4. 用 `Runtime.evaluate` 点击 tab、行、按钮并填入表单，验证真实 React 状态；
5. 用 `Page.captureScreenshot` 保存 1440×1040 截图；
6. 监听 `Runtime.exceptionThrown` 与 `Runtime.consoleAPICalled(type=error)`。

### 7.3 实际操作

```text
需求页
  → 新建「账单筛选与导出优化」→ 确认 → 拆出 3 个任务
  → 新建「消息通知延迟排查」（待确认）
  → 新建「月度对账单口径确认」→ 确认（已确认）
  → 列表 / 看板切换
任务页
  → 列表 / 看板切换
  → 打开「实现账单列表筛选接口」详情，检查需求、验收、产物
  → 删除「补充筛选与导出回归测试」，确认软删除后列表消失
项目页
  → 检查系统级/项目级边界和两张项目身份卡
  → 点击 NEW_CENTER_APP 卡片「项目设置」，确认设置页默认选中该项目
收件箱
  → 记录「财务同事 · 王琳」并保留未处理
  → 记录「运营同事 · 李哲」并转成需求，确认从未处理列表消失
记忆
  → 新建并关联证据产物 `ART_DEMO_EXPORT_CHECK`
  → 确认记忆，检查操作按钮消失
评审
  → 检查统计与空状态
```

### 7.4 截图

| 文件 | 内容 |
|---|---|
| `evidence/ui-projects.png` | 项目身份卡 + 系统/项目边界 |
| `evidence/ui-requirements.png` | 需求列表 + 项目栏 + 详情 |
| `evidence/ui-requirements-board.png` | 需求看板 4 列 + 选中卡片 |
| `evidence/ui-requirement-create.png` | 新建需求 composer |
| `evidence/ui-tasks.png` | 任务列表 + 详情空态 |
| `evidence/ui-tasks-board.png` | 任务看板按状态分列 |
| `evidence/ui-task-detail.png` | 任务详情 + 产物 |
| `evidence/ui-task-delete.png` | 删除后的任务列表 |
| `evidence/ui-inbox.png` | 收件箱列表 + 转需求详情 |
| `evidence/ui-memory.png` | 记忆详情 + 已确认状态 |
| `evidence/ui-reviews.png` | 评审统计 + 空状态 |
| `evidence/ui-final-prototype.png` | 最终合成原型 `00-final` |

### 7.5 结果

- 所有页面在 1440×1040 窗口（实际视口 1416×948）下无横向溢出、无控制台错误；
- 新建、确认、拆分、列表/看板切换、任务删除、收件转需求、记忆确认均通过真实 UI 操作；
- 删除任务的记录从列表消失，API/数据库保留软删除语义；
- 评审页无记录时显示明确空状态；评审通过/退回的状态机由 `xg-service.spec.ts` 覆盖。

## 8. 已知失败基线

Windows 上 upstream 全量测试仍有 8 个文件失败（`sleep` / `tmux` / `sh` / 路径引号），与雄大无关；xg 测试单独全绿。
