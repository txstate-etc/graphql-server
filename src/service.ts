import { filterAsync } from 'txstate-utils'
import { Context, Type } from './context'

export abstract class BaseService<AuthType = any> {
  constructor (protected ctx: Context<AuthType>) {}

  get loaders () {
    return this.ctx.loaders
  }

  get auth () {
    return this.ctx.auth
  }

  svc <T extends BaseService> (ServiceType: Type<T>): T {
    return this.ctx.svc(ServiceType)
  }

  timing (...messages: string[]) {
    return this.ctx.timing(...messages)
  }

  requireAuth () {
    return this.ctx.requireAuth()
  }
}

export abstract class AuthorizedService<AuthType = any, ObjType = any, RedactedType = ObjType> extends BaseService<AuthType> {
  async removeUnauthorized (object: ObjType|undefined): Promise<RedactedType|undefined>
  async removeUnauthorized (objects: ObjType[]): Promise<RedactedType[]>
  async removeUnauthorized (objects: ObjType[]|ObjType|undefined) {
    if (objects == null) return undefined
    if (Array.isArray(objects)) {
      const visible = await filterAsync(objects, async obj => await this.mayView(obj))
      return await Promise.all(visible.map(async obj => await this.removeProperties(obj))) as RedactedType[]
    }
    if (await this.mayView(objects)) return await this.removeProperties(objects)
  }

  /**
   * Override this method for any services that need to hide certain properties
   * from unauthorized users. For example, a User record might be visible to everyone
   * for directory purposes, but User.socialSecurityNumber needs to be removed
   * for all but the most privileged viewers.
   *
   * This method should not mutate the incoming object; return a new object instead.
   */
  protected async removeProperties (object: ObjType): Promise<RedactedType> {
    return object as unknown as RedactedType
  }

  abstract mayView (obj: ObjType): Promise<boolean>
}
