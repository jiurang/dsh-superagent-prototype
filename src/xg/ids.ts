/** Identifier helpers for xg records; requirement and task IDs are readable inside a project. */
import { randomUUID } from 'node:crypto'

/** Random, collision-resistant identifier with a short readable prefix. */
export const newId = (prefix: string): string => `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 12)}`

/** Requirement ID inside a project, such as `BIL-R3`. */
export const requirementId = (shortCode: string, seqNo: number): string => `${shortCode}-R${seqNo}`

/** Task ID inside a project, such as `BIL-42`. */
export const taskId = (shortCode: string, seqNo: number): string => `${shortCode}-${seqNo}`

/** Attempt ID inside a task, such as `BIL-42-A2`. */
export const attemptId = (task: string, seqNo: number): string => `${task}-A${seqNo}`

/** Memory ID, such as `MEM-...`; readable prefixes help panel search. */
export const memoryId = (): string => newId('MEM')

/** Normalize a user-entered project short code, rejecting empty or punctuation-only values. */
export function normalizeShortCode(value: string): string {
  const code = value.trim().toUpperCase()
  if (!/^[A-Z][A-Z0-9_-]{0,19}$/.test(code)) {
    throw new Error('项目短码必须以字母开头，只含字母、数字、下划线或连字符，最多 20 位')
  }
  return code
}
