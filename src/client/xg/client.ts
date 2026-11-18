/** Typed, dependency-free fetch helpers for the xg business API under `/xg/api`. */
import type { XgApi, XgResponse, XgRoute } from '../../xg/api-contract.ts'

type GetKey = Extract<XgRoute, `GET ${string}`>
type PostKey = Extract<XgRoute, `POST ${string}`>
type PathOf<Route extends XgRoute> = Route extends `${string} ${infer Path}` ? Path : never
/** Path-only GET routes, such as `/overview` or `/tasks/:id`. */
export type XgGetPath = PathOf<GetKey>
/** Path-only POST routes, such as `/tasks/:id/dispatch`. */
export type XgPostPath = PathOf<PostKey>
type KeyOfPath<Method extends 'GET' | 'POST', Path extends string> = Extract<XgRoute, `${Method} ${Path}`>
type RouteKey<Method extends 'GET' | 'POST', Route extends string> = Extract<Route extends XgRoute ? Route : KeyOfPath<Method, Route>, XgRoute>
type BodyOf<Route extends XgRoute> = XgApi[Route] extends { body: infer Body } ? Body : undefined

export interface XgRequestOptions {
  /** Values for `:name` placeholders in the route path. */
  params?: Record<string, string>
  /** Query parameters; undefined, null and empty values are skipped. */
  query?: Record<string, string | number | boolean | null | undefined>
}

/** Build `/xg/api` URL from a method-qualified route key or a path-only route. */
function urlOf(route: string, options: XgRequestOptions): string {
  const [first, second] = route.trim().split(/\s+/)
  const path = second ?? first ?? ''
  if (!path.startsWith('/')) throw new Error(`无效的 xg 路由：${route}`)
  const withParams = path.replace(/:([A-Za-z][\w]*)/g, (match, name: string) => {
    const value = options.params?.[name]
    if (value === undefined || value === '') throw new Error(`缺少 xg 路由参数：${name}`)
    return encodeURIComponent(value)
  })
  const search = new URLSearchParams()
  for (const [name, value] of Object.entries(options.query ?? {})) {
    if (value === undefined || value === null || value === '') continue
    search.set(name, String(value))
  }
  const query = search.toString()
  return `/xg/api${withParams}${query ? `?${query}` : ''}`
}

/** Send one request, translating a non-2xx response into an Error carrying the server's `error` text. */
async function send(method: 'GET' | 'POST', route: string, body: unknown, options: XgRequestOptions): Promise<unknown> {
  const headers: Record<string, string> = { 'x-orchestrator-request': '1' }
  if (method === 'POST') headers['content-type'] = 'application/json'
  let response: Response
  try {
    response = await fetch(urlOf(route, options), { method, headers, ...body === undefined ? {} : { body: JSON.stringify(body) } })
  } catch {
    throw new Error('无法连接到 xg 服务，请稍后重试。')
  }
  const text = await response.text()
  let value: unknown
  try {
    value = text ? JSON.parse(text) as unknown : undefined
  } catch {
    value = undefined
  }
  if (!response.ok) {
    const error = (value as { error?: unknown } | undefined)?.error
    throw new Error(typeof error === 'string' && error ? error : `请求失败（${response.status}）。`)
  }
  return value
}

/** Read one xg endpoint. Routes accept either `GET /overview` or `/overview`. */
export function xgGet<Route extends GetKey | XgGetPath>(route: Route, options: XgRequestOptions = {}):
  Promise<XgResponse<RouteKey<'GET', Route>>> {
  return send('GET', route, undefined, options) as Promise<XgResponse<RouteKey<'GET', Route>>>
}

/** Call one xg mutation. Routes accept either `POST /projects` or `/projects`; body is omitted for bodyless routes. */
export function xgPost<Route extends PostKey | XgPostPath>(route: Route, body?: BodyOf<RouteKey<'POST', Route>>,
  options: XgRequestOptions = {}): Promise<XgResponse<RouteKey<'POST', Route>>> {
  return send('POST', route, body, options) as Promise<XgResponse<RouteKey<'POST', Route>>>
}
