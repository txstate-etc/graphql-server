import type { Multipart } from '@fastify/multipart'
import { DataLoaderFactory } from 'dataloader-factory'
import type { FastifyRequest } from 'fastify'
import type { FastifyTxStateAuthInfo } from 'fastify-txstate'
import { omit, sleep } from 'txstate-utils'
import { AuthError } from './errors.js'
import { PaginationResponse, CursorResponse, SortDirection } from './pagination.js'
import type { ListOptions, CursorListOptions, SortEntry } from './pagination.js'
import type { BaseService } from './service.js'
import type { UploadFiles } from './models.js'

export type Type<T> = new (...args: any[]) => T

/**
 * How long (ms) `getPaginationInfo` waits for the matching paginated resolver to check in on the
 * per-queryType deferred before giving up and resolving `undefined`. Only ever paid in full when a
 * client selects `pageInfo { <queryType> }` without requesting the paginated field itself (or that
 * field errors before calling `executePaginated`); once the field checks in there is no timeout on
 * the work itself.
 */
const PAGE_INFO_ARRIVAL_TIMEOUT = 250

/**
 * Resolve the effective sort: prefer the client's `sort`, fall back to `defaultSort`, and fill in
 * `direction: ASC` for any entry that omitted it. The result is what gets seeded onto `pageInfo.sortOrder`,
 * so the default direction is pushed back to the client in the echoed sort order. Returns `undefined`
 * when neither a client sort nor a default was supplied.
 */
function resolveSortOrder (sort?: SortEntry[], defaultSort?: SortEntry[]): SortEntry[] | undefined {
  return (sort?.length ? sort : defaultSort)?.map(s => ({ field: s.field, direction: s.direction ?? SortDirection.ASC }))
}

export class MockContext<AuthType extends FastifyTxStateAuthInfo = FastifyTxStateAuthInfo> {
  public auth?: AuthType
  /**
   * The value resolved by `GQLStartOpts.loadScopeData` for this request, populated by the
   * server before any resolver runs. Typed as `unknown` on `Context` itself — cast inside
   * resolvers (`const scope = ctx.scopeData as MyScope`). The `GQLStartOpts` generic types
   * `loadScopeData` and `fieldIsInScope` consistently against your scope shape.
   */
  public scopeData?: unknown
  protected serviceInstances: Map<any, any>
  public loaders: DataLoaderFactory<this>
  private static executeQuery: (ctx: MockContext, query: string, variables: any, operationName?: string) => Promise<any>
  protected parts: AsyncIterableIterator<Multipart> | undefined
  protected req?: FastifyRequest

  constructor (auth?: AuthType, req?: FastifyRequest) {
    this.loaders = new DataLoaderFactory(this)
    this.serviceInstances = new Map()
    this.auth = auth
    this.req = req
  }

  svc <T extends BaseService> (ServiceType: Type<T>) {
    if (!this.serviceInstances.has(ServiceType)) this.serviceInstances.set(ServiceType, new ServiceType(this))
    return this.serviceInstances.get(ServiceType) as T
  }

  private lasttime?: Date
  timing (...messages: string[]) {
    const now = new Date()
    const elapsed = now.getTime() - (this.lasttime ?? now).getTime()
    if (this.req) this.req.log.debug({ messages }, `timing: ${elapsed}ms`)
    // eslint-disable-next-line no-console -- fallback for MockContext used outside a request (e.g. tests)
    else console.debug(elapsed, ...messages)
    this.lasttime = now
  }

  authForLog (): Partial<AuthType> | undefined {
    if (this.auth == null) return undefined
    return omit(this.auth, 'token', 'accessToken', 'issuerConfig') as Partial<AuthType>
  }

  requireAuth () {
    if (this.auth == null) throw new AuthError()
  }

  /**
   * Rendezvous between a paginated resolver and the `pageInfo` field resolver reading it back,
   * keyed by queryType. Whichever side arrives first creates the deferred. `executePaginated` /
   * `executeCursorPaginated` register their in-flight execution on it (each settles with the
   * populated page-info object when its work completes) and fire the `checkin` signal;
   * `getPaginationInfo` awaits the signal and then the registered execution. Neither side depends
   * on how long the other spends in middleware or auth checks.
   *
   * Executions register in one of two slots so that the winner can be chosen at read time: when
   * the same queryType runs both paginated and unpaginated in one operation (aliases), the
   * paginated invocation's metadata wins no matter which registered first. `paginatedExecution`
   * also doubles as the duplicate guard — a second explicitly paginated invocation of the same
   * queryType is an error, while unpaginated invocations neither trigger nor count toward that
   * collision.
   */
  protected pageInfoDeferreds: Record<string, { arrival: Promise<void>, checkin: () => void, paginatedExecution?: Promise<unknown>, unpaginatedExecution?: Promise<unknown> } | undefined> = {}

  protected pageInfoDeferred (queryType: string) {
    let deferred = this.pageInfoDeferreds[queryType]
    if (deferred == null) {
      let checkin!: () => void
      const arrival = new Promise<void>(resolve => { checkin = resolve })
      deferred = { arrival, checkin }
      this.pageInfoDeferreds[queryType] = deferred
    }
    return deferred
  }

  /**
   * Shared body of `executePaginated` / `executeCursorPaginated`: guards against a duplicate
   * paginated invocation, starts the work, registers the in-flight execution for
   * `getPaginationInfo` to read back, and returns the work's results.
   */
  protected async executeWithPageInfo <T, TInfo> (queryType: string, paginationRequested: boolean, pageInfo: TInfo, work: (pageInfo: TInfo) => Promise<T> | T): Promise<T | undefined> {
    const deferred = this.pageInfoDeferred(queryType)
    if (paginationRequested && deferred.paginatedExecution != null) throw new Error('Cannot execute more than one paginated request per top-level Query resolver.')
    let ret: T | undefined
    const executePromise = (async () => {
      ret = await work(pageInfo)
      return pageInfo
    })()
    if (paginationRequested) deferred.paginatedExecution = executePromise
    else deferred.unpaginatedExecution ??= executePromise
    deferred.checkin()
    await executePromise
    return ret
  }

  /**
   * A lighter-weight alternative to the nodes/edges connection pattern, for paginating a top-level
   * Query field by **page number**. It builds a `PaginationResponse` (`pageInfo`) from the requested
   * `ListOptions` and hands it to your `work` callback, which runs the query and populates
   * `pageInfo.finalPage` (and optionally `pageInfo.sortOrder`) as a side effect before returning the
   * page of results.
   *
   * The populated `pageInfo` is stashed on the context keyed by `queryType` so a sibling
   * `pageInfo { <queryType> }` selection in the same request can read it back via `getPaginationInfo`.
   * Because the state is keyed per query type, this only works for top-level Query fields — not
   * nested fields. See the README "Pagination" section.
   *
   * @param queryType  A stable key naming this query, matching the `PageInformation` field resolver
   *                   that will report its pagination info (e.g. `'books'`).
   * @param opts       The client's `pagination` and `sort` arguments (each independent and optional),
   *                   plus an optional `defaultSort` the framework applies when the client sent none
   *                   and an optional `defaultPageSize` used when the client paginates but omits
   *                   `perPage` (defaults to 100).
   *                   The effective sort is seeded onto `pageInfo.sortOrder` so the `work` callback
   *                   reads it to build the query and the same value is echoed back to the client.
   * @param work       Runs the query; receives the `pageInfo` to populate and returns the results.
   */
  async executePaginated <T> (queryType: string, opts: { pagination?: ListOptions, sort?: SortEntry[], defaultSort?: SortEntry[], defaultPageSize?: number }, work: (pageInfo: PaginationResponse) => Promise<T> | T) {
    const { pagination, sort, defaultSort, defaultPageSize } = opts
    const paginationRequested = pagination?.page != null || pagination?.perPage != null
    const pageInfo = new PaginationResponse({ page: pagination?.page, perPage: pagination?.perPage, sortOrder: resolveSortOrder(sort, defaultSort), defaultPageSize })
    return await this.executeWithPageInfo(queryType, paginationRequested, pageInfo, work)
  }

  /**
   * Like `executePaginated`, but paginating by **cursor** (forward-only). It hands your `work`
   * callback a `CursorResponse` to populate (`hasNextPage`, `endCursor`, and optionally `sortOrder`)
   * before returning the page of results. The client controls the page with `perPage` (how many) and
   * `after` (where to resume — the `endCursor` from the previous page).
   *
   * @param queryType  A stable key naming this query (e.g. `'books'`).
   * @param opts       The client's `pagination` and `sort` arguments (each independent and optional),
   *                   plus an optional `defaultSort` the framework applies when the client sent none
   *                   and an optional `defaultPageSize` used when the client paginates but omits
   *                   `perPage` (defaults to 100).
   *                   The effective sort is seeded onto `pageInfo.sortOrder` so the `work` callback
   *                   reads it to build the query and the same value is echoed back to the client.
   * @param work       Runs the query; receives the `pageInfo` to populate and returns the results.
   */
  async executeCursorPaginated <T> (queryType: string, opts: { pagination?: CursorListOptions, sort?: SortEntry[], defaultSort?: SortEntry[], defaultPageSize?: number }, work: (pageInfo: CursorResponse) => Promise<T> | T) {
    const { pagination, sort, defaultSort, defaultPageSize } = opts
    const paginationRequested = pagination?.after != null || pagination?.perPage != null
    const pageInfo = new CursorResponse({ perPage: pagination?.perPage, after: pagination?.after, sortOrder: resolveSortOrder(sort, defaultSort), defaultPageSize })
    return await this.executeWithPageInfo(queryType, paginationRequested, pageInfo, work)
  }

  /**
   * Read back the page-info object populated by `executePaginated` / `executeCursorPaginated` for the
   * given `queryType` in this request. Call this from a `@FieldResolver` on `PageInformation` so
   * clients can fetch `pageInfo { <queryType> { ... } }` alongside the paginated results. Resolves to
   * `undefined` if no matching paginated query ran, or if it failed — the failure is already
   * reported as the paginated field's own error, so erroring here too would double-count one
   * underlying failure in the response's `errors` array. Defaults to `PaginationResponse`; pass a
   * type argument when reading back a `CursorResponse`.
   *
   * Waits for the paginated resolver to check in, however long it spends in middleware or auth
   * checks first, so this is safe regardless of field order or resolver latency. Only the wait for
   * that check-in is capped (see `PAGE_INFO_ARRIVAL_TIMEOUT`), so a `pageInfo` selection whose
   * matching paginated field was not requested — or errored before reaching `executePaginated` —
   * degrades to `undefined` instead of hanging the request; once checked in, the work itself may
   * take as long as it needs.
   */
  async getPaginationInfo <TInfo = PaginationResponse> (queryType: string): Promise<TInfo | undefined> {
    const deferred = this.pageInfoDeferred(queryType)
    const arrived = () => deferred.paginatedExecution != null || deferred.unpaginatedExecution != null
    if (!arrived()) await Promise.race([deferred.arrival, sleep(PAGE_INFO_ARRIVAL_TIMEOUT)])
    if (!arrived()) return undefined
    // wait for whichever execution is registered so far, swallowing its outcome, then pick the
    // winner fresh: a paginated invocation registering while unpaginated work ran must still win
    await Promise.allSettled([deferred.paginatedExecution ?? deferred.unpaginatedExecution])
    // swallow a failure rather than rethrow: the paginated field reports its own error already
    return await (deferred.paginatedExecution ?? deferred.unpaginatedExecution)?.catch(() => undefined) as TInfo | undefined
  }

  /**
   * Override in a Context subclass to run async setup once per request after
   * `ctx.auth` has been populated and before any query execution. Typical use
   * is to prefetch the authenticated user's roles or permissions so that all
   * downstream authorization checks (e.g. `mayView`) can stay synchronous.
   *
   * The server awaits this between auth resolution and `send403` / query
   * execution. The default implementation defers to the deprecated
   * `waitForAuth` so legacy subclasses keep working.
   */
  async prefetch (): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- backwards compatibility
    await this.waitForAuth()
  }

  /**
   * @deprecated Override `prefetch` instead. This hook predates the v3 auth
   * rewrite — when `Context` no longer fetches its own auth, the name became
   * misleading. The default `prefetch` implementation still awaits this so
   * existing subclasses continue to run; new code should override `prefetch`.
   */
  async waitForAuth (): Promise<void> {
    /* default no-op — break the cycle with prefetch */
  }

  /**
   * Run another GraphQL operation against the same schema, sharing this context's auth,
   * dataloaders, and service instances.
   *
   * The sub-operation executes against a prototype-derived copy of this context with its own
   * pagination state, so a paginated query inside the sub-operation neither collides with (false
   * "more than one paginated request" error) nor pollutes the pagination state of the operation
   * that spawned it — and each `query()` call on a reused MockContext starts fresh. One
   * consequence: property writes a resolver makes on the context during the sub-operation land on
   * the derived copy and are not visible here afterward; reads are unaffected.
   */
  async query <T> (query: string, variables?: any): Promise<T> {
    const sub = Object.create(this) as this
    sub.pageInfoDeferreds = {}
    return await MockContext.executeQuery(sub, query, variables) as T
  }

  setParts (parts: AsyncIterableIterator<Multipart> | undefined) {
    this.parts = parts
  }

  async* files (): UploadFiles {
    if (!this.parts) return
    let idx = 0
    for await (const p of this.parts) {
      if (p.type === 'file') {
        try {
          yield { multipartIndex: idx, name: p.filename, mime: p.mimetype, stream: p.file }
          idx += 1
        } finally {
          if (!p.file.readableEnded) {
            for await (const chunk of p.file) {
              // drain the stream to avoid memory leaks
            }
          }
        }
      }
    }
  }

  /**
   * In case we received uploads but our mutation did not handle them, we don't
   * want to leave any file streams open, so our `/graphql` post handler will call
   * this after graphql execution for cleanup.
   */
  async drainFiles () {
    for await (const file of this.files()) {
      for await (const chunk of file.stream) {
        // drain the stream to avoid memory leaks
      }
    }
  }
}

export class Context<AuthType extends FastifyTxStateAuthInfo = FastifyTxStateAuthInfo> extends MockContext<AuthType> {
  constructor (req?: FastifyRequest) {
    super(req?.auth as AuthType | undefined, req)
  }
}
