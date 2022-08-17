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

/*
  * This service should not mutate any incoming objects; so will make a copy of
  * the objects before passing them to the removeProperties method.
  */
export abstract class AuthorizedService<AuthType = any, ObjType = any, RedactedType = ObjType> extends BaseService<AuthType> {
  async removeUnauthorized (object: ObjType|undefined): Promise<RedactedType|ObjType|undefined>
  async removeUnauthorized (objects: ObjType[]): Promise<RedactedType[]|ObjType[]>
  async removeUnauthorized (objects: ObjType[]|ObjType|undefined) {
    if (objects == null) return undefined
    if (Array.isArray(objects)) {
      const visible = await filterAsync(objects, async obj => (obj ? await this.mayView(obj) : false))
      return await Promise.all(visible.map(async obj => await this.removeProperties(obj))) as RedactedType[]|ObjType[]
    }
    if (await this.mayView(objects)) return await this.removeProperties(objects)
  }

  /**
   * Override this method for any services that need to hide certain properties
   * from unauthorized users. For example, a User record might be visible to everyone
   * for directory purposes, but User.socialSecurityNumber needs to be removed
   * for all but the most privileged viewers.
   *
   * Do NOT mutate the object given, it will be cached in various dataloaders and you
   * don't want to alter the cache. Return a new cloned object instead. You may find
   * the txstate-utils functions clone, pick, and omit especially helpful.
   *
   * Removing foreign key info in this function can be problematic.
   */
  protected async removeProperties (object: ObjType): Promise<RedactedType|ObjType> {
    return object as unknown as ObjType
  }

  /**
   * Override this method for any services that need to filter the entire object
   * from unauthorized users. For example an Address record may only be visible
   * under a certain context where user is looking at their own address. Returning
   * a false would filter out the address object so that an undefined would be
   * returned or the object would be remove from lists.
   */
  protected async mayView (obj: ObjType): Promise<boolean> {
    return true
  }
}
