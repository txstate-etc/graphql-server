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

export abstract class AuthorizedService<AuthType = any, ObjType = any> extends BaseService<AuthType> {
  async removeUnauthorized (objects: ObjType[]) {
    return await filterAsync(objects, async obj => await this.mayView(obj))
  }

  abstract mayView (obj: ObjType): Promise<boolean>
}
