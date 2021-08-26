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
}

export abstract class AuthorizedService<AuthType = any> extends BaseService<AuthType> {
  async removeUnauthorized <T> (objects: T[]) {
    return await filterAsync(objects, async obj => await this.mayView(obj))
  }

  abstract mayView <T> (obj: T): Promise<boolean>
}
