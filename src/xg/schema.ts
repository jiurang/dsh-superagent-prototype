/** xg schema, versioned separately from the upstream orchestrator schema. */
import type { DatabaseSync } from 'node:sqlite'

/** Current xg schema version. Bump for every additive migration. */
export const XG_SCHEMA_VERSION = 4

/** Applied in order; index 0 creates version 1. */
export const XG_MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE xg_projects (
    id            TEXT PRIMARY KEY,
    short_code    TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    root_path     TEXT,
    sensitivity   TEXT NOT NULL DEFAULT '内部'
                  CHECK (sensitivity IN ('公开','内部','机密')),
    status        TEXT NOT NULL DEFAULT '活跃'
                  CHECK (status IN ('活跃','暂停','归档')),
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  );

  CREATE TABLE xg_inbox_items (
    id            TEXT PRIMARY KEY,
    project_id    TEXT,
    channel       TEXT NOT NULL
                  CHECK (channel IN ('企微','邮箱','电话','同事','其他')),
    contact       TEXT,
    raw_context   TEXT,
    external_ref  TEXT,
    status        TEXT NOT NULL DEFAULT '未处理'
                  CHECK (status IN ('未处理','已建需求','已忽略')),
    received_at   TEXT NOT NULL,
    triaged_at    TEXT
  );
  CREATE UNIQUE INDEX xg_inbox_external_uidx
    ON xg_inbox_items (channel, external_ref)
    WHERE external_ref IS NOT NULL;
  CREATE INDEX xg_inbox_status_idx ON xg_inbox_items (status, received_at);

  CREATE TABLE xg_requirements (
    id            TEXT PRIMARY KEY,
    project_id    TEXT NOT NULL REFERENCES xg_projects(id),
    seq_no        INTEGER NOT NULL,
    source_id     TEXT REFERENCES xg_inbox_items(id),
    source_note   TEXT,
    title         TEXT NOT NULL,
    description   TEXT,
    status        TEXT NOT NULL DEFAULT '待确认'
                  CHECK (status IN ('待确认','已确认','已拆分','已关闭')),
    priority      TEXT CHECK (priority IN ('P0','P1','P2','P3')),
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    UNIQUE (project_id, seq_no),
    CHECK (source_id IS NOT NULL OR source_note IS NOT NULL)
  );
  CREATE INDEX xg_requirements_project_status_idx ON xg_requirements (project_id, status);

  CREATE TABLE xg_tasks (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL REFERENCES xg_projects(id),
    requirement_id  TEXT NOT NULL REFERENCES xg_requirements(id),
    seq_no          INTEGER NOT NULL,
    title           TEXT NOT NULL,
    description     TEXT,
    type            TEXT NOT NULL
                    CHECK (type IN ('设计','开发','排障','评审')),
    status          TEXT NOT NULL
                    CHECK (status IN ('就绪','进行中','评审','待验收','完成','阻塞','取消')),
    priority        TEXT NOT NULL CHECK (priority IN ('P0','P1','P2','P3')),
    acceptance      TEXT,
    current_attempt_id TEXT,
    auto_dispatch   INTEGER NOT NULL DEFAULT 0,
    blocked_from_status TEXT,
    accepted_by     TEXT,
    accepted_at     TEXT,
    completed_at    TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    UNIQUE (project_id, seq_no)
  );
  CREATE INDEX xg_tasks_project_status_idx ON xg_tasks (project_id, status);
  CREATE INDEX xg_tasks_project_type_idx ON xg_tasks (project_id, type);
  CREATE INDEX xg_tasks_requirement_idx ON xg_tasks (project_id, requirement_id);

  CREATE TABLE xg_attempts (
    id                TEXT PRIMARY KEY,
    task_id           TEXT NOT NULL REFERENCES xg_tasks(id),
    ticket_id         TEXT,
    assignment_id     TEXT,
    worker_session_id TEXT,
    stage             TEXT,
    status            TEXT NOT NULL DEFAULT '运行中'
                      CHECK (status IN ('运行中','就绪','阻塞','失败','结束','取消')),
    last_report_at    TEXT,
    attention         TEXT,
    token_cost        INTEGER,
    runtime_version   TEXT,
    created_at        TEXT NOT NULL,
    ended_at          TEXT
  );
  CREATE INDEX xg_attempts_task_idx ON xg_attempts (task_id, created_at);
  CREATE INDEX xg_attempts_ticket_idx ON xg_attempts (ticket_id);

  CREATE TABLE xg_specs (
    id            TEXT PRIMARY KEY,
    project_id    TEXT NOT NULL REFERENCES xg_projects(id),
    task_id       TEXT REFERENCES xg_tasks(id),
    content       TEXT NOT NULL,
    status        TEXT NOT NULL
                  CHECK (status IN ('草稿','已批准','已废弃')),
    approved_by   TEXT,
    approved_at   TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  );
  CREATE INDEX xg_specs_project_idx ON xg_specs (project_id, status);

  CREATE TABLE xg_artifacts (
    id            TEXT PRIMARY KEY,
    task_id       TEXT NOT NULL REFERENCES xg_tasks(id),
    attempt_id    TEXT REFERENCES xg_attempts(id),
    type          TEXT NOT NULL CHECK (type IN ('证据','代码','文档','复盘','其他')),
    title         TEXT,
    content       TEXT,
    uri           TEXT,
    created_at    TEXT NOT NULL
  );
  CREATE INDEX xg_artifacts_task_idx ON xg_artifacts (task_id, type);

  CREATE TABLE xg_triage_steps (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id       TEXT NOT NULL REFERENCES xg_tasks(id),
    attempt_id    TEXT REFERENCES xg_attempts(id),
    stage         TEXT NOT NULL CHECK (stage IN ('取证','假设','根因')),
    content       TEXT NOT NULL,
    artifact_id   TEXT REFERENCES xg_artifacts(id),
    created_at    TEXT NOT NULL
  );
  CREATE INDEX xg_triage_task_idx ON xg_triage_steps (task_id, stage, id);

  CREATE TABLE xg_reviews (
    id                      TEXT PRIMARY KEY,
    task_id                 TEXT NOT NULL REFERENCES xg_tasks(id),
    review_attempt_id       TEXT NOT NULL REFERENCES xg_attempts(id),
    implementation_attempt_id TEXT NOT NULL REFERENCES xg_attempts(id),
    reviewer                TEXT,
    decision                TEXT NOT NULL CHECK (decision IN ('通过','退回')),
    comments                TEXT,
    created_at              TEXT NOT NULL,
    CHECK (review_attempt_id <> implementation_attempt_id)
  );
  CREATE INDEX xg_reviews_task_idx ON xg_reviews (task_id, created_at);

  CREATE TABLE xg_memory_entries (
    id                TEXT PRIMARY KEY,
    project_id        TEXT NOT NULL REFERENCES xg_projects(id),
    type              TEXT NOT NULL
                      CHECK (type IN ('领域','决策','经验','故障','交接')),
    title             TEXT NOT NULL,
    content           TEXT NOT NULL,
    status            TEXT NOT NULL DEFAULT '草稿'
                      CHECK (status IN ('草稿','待复核','已确认','已废弃')),
    source_type       TEXT NOT NULL
                      CHECK (source_type IN ('任务','会话','人工')),
    source_ref        TEXT,
    tags              TEXT,
    last_verified_at  TEXT,
    confirmed_by      TEXT,
    confirmed_at      TEXT,
    superseded_by     TEXT,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
  );
  CREATE INDEX xg_memory_project_type_idx ON xg_memory_entries (project_id, type, status);

  CREATE VIRTUAL TABLE xg_memory_fts USING fts5(
    title, content, content='xg_memory_entries', content_rowid='rowid', tokenize='trigram'
  );

  CREATE TRIGGER xg_memory_ai AFTER INSERT ON xg_memory_entries BEGIN
    INSERT INTO xg_memory_fts(rowid, title, content)
    VALUES (new.rowid, new.title, new.content);
  END;
  CREATE TRIGGER xg_memory_ad AFTER DELETE ON xg_memory_entries BEGIN
    INSERT INTO xg_memory_fts(xg_memory_fts, rowid, title, content)
    VALUES ('delete', old.rowid, old.title, old.content);
  END;
  CREATE TRIGGER xg_memory_au AFTER UPDATE ON xg_memory_entries BEGIN
    INSERT INTO xg_memory_fts(xg_memory_fts, rowid, title, content)
    VALUES ('delete', old.rowid, old.title, old.content);
    INSERT INTO xg_memory_fts(rowid, title, content)
    VALUES (new.rowid, new.title, new.content);
  END;

  CREATE TABLE xg_memory_refs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    memory_id       TEXT NOT NULL REFERENCES xg_memory_entries(id),
    ref_type        TEXT NOT NULL CHECK (ref_type IN ('代码','文档','规格')),
    ref_path        TEXT NOT NULL,
    ref_hash        TEXT,
    last_checked_at TEXT
  );
  CREATE UNIQUE INDEX xg_memory_refs_uidx ON xg_memory_refs (memory_id, ref_type, ref_path);

  CREATE TABLE xg_memory_evidence (
    memory_id     TEXT NOT NULL REFERENCES xg_memory_entries(id) ON DELETE CASCADE,
    artifact_id   TEXT NOT NULL REFERENCES xg_artifacts(id),
    created_at    TEXT NOT NULL,
    PRIMARY KEY (memory_id, artifact_id)
  );

  CREATE TABLE xg_task_events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id       TEXT NOT NULL REFERENCES xg_tasks(id),
    event_type    TEXT NOT NULL,
    actor         TEXT,
    payload       TEXT,
    created_at    TEXT NOT NULL
  );
  CREATE INDEX xg_task_events_task_idx ON xg_task_events (task_id, created_at);

  CREATE TABLE xg_audit_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id    TEXT,
    actor         TEXT,
    action        TEXT NOT NULL,
    entity_type   TEXT NOT NULL,
    entity_id     TEXT NOT NULL,
    before_state  TEXT,
    after_state   TEXT,
    created_at    TEXT NOT NULL
  );
  CREATE INDEX xg_audit_project_idx ON xg_audit_log (project_id, created_at);
  `,
  // v2: soft deletion keeps attempts, evidence, memory and audit history.
  `ALTER TABLE xg_tasks ADD COLUMN deleted_at TEXT;`,
  // v3: project-level overrides live beside the system-level dsh-superagent settings.
  `CREATE TABLE xg_project_settings (
    project_id       TEXT PRIMARY KEY REFERENCES xg_projects(id) ON DELETE CASCADE,
    worker_provider  TEXT,
    worker_model     TEXT,
    worker_effort    TEXT,
    auto_dispatch    INTEGER NOT NULL DEFAULT 0,
    default_priority TEXT CHECK (default_priority IN ('P0','P1','P2','P3')),
    updated_at       TEXT NOT NULL
  );`,
  // v4: soft deletion for requirements and inbox items, plus agent proposals awaiting a person.
  `
  ALTER TABLE xg_requirements ADD COLUMN deleted_at TEXT;
  ALTER TABLE xg_inbox_items ADD COLUMN deleted_at TEXT;

  CREATE TABLE xg_proposals (
    id            TEXT PRIMARY KEY,
    project_id    TEXT NOT NULL REFERENCES xg_projects(id),
    kind          TEXT NOT NULL,
    target_type   TEXT NOT NULL,
    target_id     TEXT NOT NULL,
    base_revision TEXT,
    title         TEXT NOT NULL,
    summary       TEXT,
    payload       TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT '待确认'
                  CHECK (status IN ('待确认','已应用','已拒绝','已过期')),
    created_by    TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    resolved_by   TEXT,
    resolved_at   TEXT,
    resolution    TEXT
  );
  CREATE INDEX xg_proposals_project_status_idx
    ON xg_proposals (project_id, status, created_at);
  `,
]

/** Creates or upgrades xg tables; the version lives in `xg_schema_version`, apart from the upstream `kv` schema. */
export function migrateXg(db: DatabaseSync): void {
  db.exec('PRAGMA foreign_keys=ON')
  db.exec('CREATE TABLE IF NOT EXISTS xg_schema_version (version INTEGER NOT NULL)')
  const row = db.prepare('SELECT version FROM xg_schema_version LIMIT 1').get() as { version?: number } | undefined
  const current = row?.version ?? 0
  if (current > XG_SCHEMA_VERSION) throw new Error(`Unsupported xg database version ${current}`)
  if (current === XG_SCHEMA_VERSION) return
  db.exec('BEGIN IMMEDIATE')
  try {
    for (let version = current; version < XG_SCHEMA_VERSION; version++) db.exec(XG_MIGRATIONS[version]!)
    db.exec('DELETE FROM xg_schema_version')
    db.prepare('INSERT INTO xg_schema_version (version) VALUES (?)').run(XG_SCHEMA_VERSION)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw new Error(`xg schema migration from ${current} to ${XG_SCHEMA_VERSION} failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error })
  }
}
