# dsh-superagent

> **Research prototype for reference only, not an official DeepSeek product.** This code grew out of our team's day-to-day development work, with much of the engineering done by coding agents. Treat it as research code, not production-ready software. It may still contain bugs, and its coding style and engineering practices may be inconsistent. Review and adapt it before using it in your own environment.
>
> We have adapted it for publication, so it is not identical to our internal version or the implementation described in *Exploring Super-agent Design: Towards a More Autonomous Agent System*. Some designs discussed in the article are directions for future development and are not implemented in this prototype.

dsh-superagent is a proactive coding agent for one GitHub repository, packaged as a bundle for [DeepSeek Harness](https://www.deepseek.com/en/harness/). It listens to GitHub and, optionally, Feishu. When someone allowed asks the agent for work, it opens a work item, works on it in its own agent session and directory, and answers in the original conversation, for example with a pull request. A web panel shows what needs a person.

## 雄大工作台（本 fork）

This fork adds the single-process **雄大工作台 / Xiongda Workbench** business layer described in `SUPERAGENT-DESIGN.md`: projects, inbox, requirements, one task list, execution attempts, memory, reviews, evidence, audit, and a Chinese panel. A Ticket is an execution attempt of a business task, not a second task. The business code lives in `src/xg/` and `src/client/xg/`; upstream files only carry registration hooks.

> 展示名是「雄大工作台」；内部代码、数据库表、工具和 API 仍保留历史前缀 `xg`，以免破坏已有数据库和工具名。

- v2 three-column workbench (integrated into the DSH panel): [docs/xg/v2/README.md](docs/xg/v2/README.md)
- v1 final state, test cases and browser evidence: [docs/v1/README.md](docs/v1/README.md)
- UI redesign: 5 proposals, 8 reviews, top-3 and final synthesis: [docs/v1/ui-design/README.md](docs/v1/ui-design/README.md)
- Local mode without GitHub: configure **设置 → 来源 → 本地** with a project root; see [docs/xg/operations.md](docs/xg/operations.md)
- Operations: [docs/xg/operations.md](docs/xg/operations.md)
- Acceptance plan: [docs/xg/acceptance.md](docs/xg/acceptance.md)
- Acceptance report: [docs/xg/acceptance-report.md](docs/xg/acceptance-report.md)
- Upstream change list: [docs/xg/upstream-changes.md](docs/xg/upstream-changes.md)
- OpenCode review: [docs/xg/opencode-test.md](docs/xg/opencode-test.md)

It is also a way of working with an agent: **take as little human attention as possible, and give as much value as possible.** An agent that can act for a whole team can also waste a whole team's attention, so it acts only when asked or when a rule the team wrote allows it, and speaks only when someone must act or can use a result. [docs/000-philosophy.md](docs/000-philosophy.md) explains the principle and what it asks of the operator.

## Setup

Setup has many steps, so an agent does it with you. Ask your coding agent:

> Read SETUP.md in this repository and set up dsh-superagent with me.

It asks one short question at a time, shows the full plan once, and then installs and configures everything. [SETUP.md](SETUP.md) is what it follows.

## Documentation

Read the numbered documents in order; each builds only on the ones before it.

- [000 Philosophy](docs/000-philosophy.md)
- [001 Domain model](docs/001-domain.md)
- [002 Authorization](docs/002-authorization.md)
- [003 Execution](docs/003-execution.md)
- [004 Prompts](docs/004-prompts.md)
- [005 Panel](docs/005-panel.md)
- [006 Deployment](docs/006-deployment.md): manual setup, configuration, upgrades and troubleshooting
- [007 Architecture](docs/007-architecture.md)
- [008 Cookbook](docs/008-cookbook.md): adding a Source

## Development

`pnpm check` runs the typecheck, the tests and the build.

## License

[MIT](LICENSE)
