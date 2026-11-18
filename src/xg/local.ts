/** Local Source kind: work on a local project without a GitHub repository or account. */
import { z } from 'zod'
import type { SourceKind } from '../sources/kind.ts'

/** Configuration of the local Source. */
export const LocalSourceSchema = z.object({
  /** Root directory of the local project; used by the workbench when a project has no root path of its own. */
  rootPath: z.string().trim().default(''),
})

/** The `local` Source. It produces no external events; it only marks this instance as a local workbench. */
export const localSourceKind: SourceKind<z.infer<typeof LocalSourceSchema>> = {
  kind: 'local',
  title: { zh: '本地', en: 'Local' },
  description: {
    zh: '雄大工作台的本地项目来源：不连接 GitHub 或飞书，Worker 直接在本地目录工作。',
    en: 'Local project Source for the Xiongda Workbench: no GitHub or Feishu connection; workers use a local directory.',
  },
  schema: LocalSourceSchema,
  fields: [{ key: 'rootPath', type: 'text', label: { zh: '本地项目根目录', en: 'Local project root' },
    hint: { zh: '例如 /home/xg/projects/billing；项目卡自己的根路径优先', en: 'For example /home/xg/projects/billing; a project card root takes precedence' } }],
  health: [],
  scope: () => ({ listened: true, observed: false }),
}
