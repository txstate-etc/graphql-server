import { filterAsync, isNotNull } from 'txstate-utils'
import { type Context, type Type } from './context'

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
    this.ctx.timing(...messages)
  }

  requireAuth () {
    this.ctx.requireAuth()
  }
}

/**
 * Use this as a base class for your service to add a removeUnauthorized method that can
 * help you filter out objects the current user isn't allowed to see.
 */
export abstract class AuthorizedService<AuthType = any, ObjType = any, RedactedType = ObjType> extends BaseService<AuthType> {
  async removeUnauthorized (object: ObjType | undefined): Promise<RedactedType | ObjType | undefined>
  async removeUnauthorized (objects: ObjType[]): Promise<RedactedType[] | ObjType[]>
  async removeUnauthorized (objects: ObjType[] | ObjType | undefined) {
    if (objects == null) return undefined
    if (Array.isArray(objects)) {
      const visible = await filterAsync(objects.filter(isNotNull), async obj => await this.mayView(obj))
      return await Promise.all(visible.map(async obj => await this.removeProperties(obj))) as RedactedType[] | ObjType[]
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
   * the txstate-utils functions clone, pick, and omit functions especially helpful.
   *
   * Removing foreign key info in this function can be problematic.
   */
  protected async removeProperties (object: ObjType): Promise<RedactedType | ObjType> {
    return object
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

/**
 * This class is the same idea as AuthorizedService but it expects you to have everything you
 * need to authorize release of an object already loaded, so that you will not have to make any
 * async calls. If you can do that, it will greatly improve performance as you will not have to make
 * several new promises per array element, which is rather expensive.
 */
export abstract class AuthorizedServiceSync<AuthType = any, ObjType = any, RedactedType = ObjType> extends BaseService<AuthType> {
  removeUnauthorized (object: ObjType | undefined): RedactedType | ObjType | undefined
  removeUnauthorized (objects: ObjType[]): RedactedType[] | ObjType[]
  removeUnauthorized (objects: ObjType[] | ObjType | undefined) {
    if (objects == null) return undefined
    if (Array.isArray(objects)) {
      const visible = objects.filter(obj => obj != null && this.mayView(obj))
      return visible.map(obj => this.removeProperties(obj)) as RedactedType[] | ObjType[]
    }
    if (this.mayView(objects)) return this.removeProperties(objects)
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
  protected removeProperties (object: ObjType): RedactedType | ObjType {
    return object
  }

  /**
   * Override this method for any services that need to filter the entire object
   * from unauthorized users. For example an Address record may only be visible
   * under a certain context where user is looking at their own address. Returning
   * a false would filter out the address object so that an undefined would be
   * returned or the object would be remove from lists.
   */
  protected mayView (obj: ObjType): boolean {
    return true
  }
}
