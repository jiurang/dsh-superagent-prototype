# 评审代理分配

8 位评审代理，每位只评 3 份方案，避免“全都看过一眼”的平均分。

| 代理 | 方案 A | 方案 B | 方案 C |
|---|---|---|---|
| agent-01 | 01-command-center | 02-editorial-workspace | 03-linear-split |
| agent-02 | 02-editorial-workspace | 03-linear-split | 04-kanban-canvas |
| agent-03 | 03-linear-split | 04-kanban-canvas | 05-timeline-flow |
| agent-04 | 04-kanban-canvas | 05-timeline-flow | 01-command-center |
| agent-05 | 05-timeline-flow | 01-command-center | 02-editorial-workspace |
| agent-06 | 01-command-center | 03-linear-split | 05-timeline-flow |
| agent-07 | 02-editorial-workspace | 04-kanban-canvas | 01-command-center |
| agent-08 | 03-linear-split | 05-timeline-flow | 02-editorial-workspace |

每份方案被评 4–5 次，足以拉开差距又避免重复劳动。

评分维度与总分公式见 `scoring-guide.md`。所有评审输出写入 `docs/v1/ui-design/scores/agent-XX.md`。
