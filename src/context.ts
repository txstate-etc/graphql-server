import type { Multipart } from '@fastify/multipart'
import { DataLoaderFactory } from 'dataloader-factory'
import type { FastifyRequest } from 'fastify'
import type { FastifyTxStateAuthInfo } from 'fastify-txstate'
import { omit } from 'txstate-utils'
import { AuthError } from './errors.js'
import type { BaseService } from './service.js'
import type { UploadFiles } from './models.js'

export type Type<T> = new (...args: any[]) => T

export class MockContext<AuthType extends FastifyTxStateAuthInfo = FastifyTxStateAuthInfo> {
  public auth?: AuthType
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

  async query <T> (query: string, variables?: any): Promise<T> {
    return await MockContext.executeQuery(this, query, variables) as T
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
