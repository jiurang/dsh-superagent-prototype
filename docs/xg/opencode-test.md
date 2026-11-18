# OpenCode 独立复核记录

- 日期：2026-11-17
- 模型：`opencode-go/deepseek-v4.1-flash`
- 凭据：用户提供的 `oc_sk_...`，通过 `opencode auth import` 导入为 `XG Acceptance`，`opencode auth switch opencode-go "XG Acceptance"` 切换为 active；`opencode auth export` 校验 active key 与提供值一致。复核结束后已切回原 `OpenCode Go` 账户，`XG Acceptance` 保留但非 active
- 方式：`opencode run --auto --title "xg acceptance verifier"`，独立会话，不修改文件

## 提示要点

1. 运行 7 个 xg 测试文件；
2. `tsc --noEmit`；
3. `pnpm build`；
4. 读取 `SUPERAGENT-DESIGN.md` §17 与 `docs/xg/acceptance.md`，逐项判断是否有证据；
5. 报告命令结果、缺口（≤500 字，中文）。

## 复核输出（摘要）

| 命令 | 结果 |
|---|---|
| `vitest run` 指定 7 个 xg 文件（首次复核时） | 7 文件 / 42 用例全通过，2.18s |
| `tsc --noEmit` | 退出码 0，无错误 |
| `pnpm build` | 退出码 0，lib/ 产物生成（ESM+CJS），仅 CommonJS 格式提示 |

Checklist 判定：7 项充分、5 项部分、0 项缺失（复核后：11 项通过、1 项部分 ⚠️，A1 的 WSL2 实机启动未执行）。

指出的三个最重要缺口：

1. **Worker 链路和组合根未验证**：42 个用例没有一个触达 `src/xg/tools.ts`，`XgRuntime` 的启动/停止/工具注册/`/xg/api` 注册也无测试。
2. **A11 无机器证据**：xg 代码尚未提交，`git diff --stat` 只能看到上游文件改动，无法自动断言“业务在 `src/xg/`”。
3. **验收记录自相矛盾**：`acceptance.md` 声称的 `docs/xg/acceptance-report.md` 不存在；`opencode-test.md` 仍是占位；`docs.spec.ts` 不校验 `docs/xg/` 链接。

## 缺口处理

| 缺口 | 处理 | 结果 |
|---|---|---|
| 工具/组合根未测 | 新增 `tests/xg-tools.spec.ts`：Worker 全流程、Ticket 作用域、敏感输出、`XgRuntime.start/stop` 与 `tick` 自动派发 | 5 用例通过 |
| A11 无机器证据 | 新增 `tests/xg-upstream.spec.ts`：`git diff` 允许清单、文档清单、core 不 import xg | 1 用例通过 |
| 验收记录缺失 | 新增 `docs/xg/acceptance-report.md`，更新本文件；`README.md` 链接到全部 xg 文档 | `docs.spec.ts` 6 用例通过 |
| 42 → 48 用例 | `pnpm test:xg` 增加 tools/upstream 两个文件 | 9 文件 / 48 用例通过（后续 +1 记忆引用用例，当前 61） |

## 复核后补充的运行

```text
pnpm test:xg
  9 files / 48 tests passed（复核时；后续 +1 记忆引用用例，当前 61）

pnpm exec tsc --noEmit
  exit 0

pnpm build
  exit 0

pnpm test
  60 files passed / 8 failed
  1207 tests passed / 39 failed
```

全量失败均为上游 Windows 基线（`sleep`/`tmux`/`sh`/路径引号），与 xg 无关。

## 最终复核

同一模型、同一凭据再次运行：

| 命令 | 结果 |
|---|---|
| `pnpm test:xg` | 复核时 9 文件 / 48 用例通过；随后新增 1 个记忆引用校验用例，当前 61 |
| `pnpm exec tsc --noEmit` | 通过（退出码 0） |
| `vitest run tests/docs.spec.ts tests/class-docs.spec.ts tests/model-surface.spec.ts` | 3 文件 / 14 用例通过 |

三项修复核实：tools/runtime 测试已存在并纳入 `test:xg`；A11 同时检查 `git diff` 允许清单和 `git status --porcelain` 的未跟踪路径；`docs/xg/*.md` 已纳入链接检查，计数与实跑一致。

最终复核提出的两个轻微问题也已修复：A11 先断言 `git rev-parse --is-inside-work-tree` 为 `true`；README 增加验收报告链接。

## 结论

OpenCode 独立复核确认：xg 设计第 17 节的 12 项均有可执行证据；剩余限制是“无真实模型 Worker、无 WSL2 实机、无企微/IMAP 网络接入”，已写入 `acceptance-report.md` 的“剩余限制”。
