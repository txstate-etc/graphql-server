import { filterAsync } from 'txstate-utils'
import { Context, Type } from './context'

export abstract class BaseService {
  constructor (protected ctx: Context) {}

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

export abstract class AuthorizedService<T> extends BaseService {
  async removeUnauthorized (objects: T[]) {
    return await filterAsync(objects, async obj => await this.mayView(obj))
  }

  abstract mayView (obj: T): Promise<boolean>
}
