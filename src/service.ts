import { filterAsync } from 'txstate-utils'
import { Context, Type } from './context'

export abstract class BaseService <T> {
  constructor (protected ctx: Context) {}

  get loader () {
    return this.ctx.dlFactory
  }

  get auth () {
    return this.ctx.auth
  }

  svc <T extends BaseService<any>> (ServiceType: Type<T>): T {
    return this.ctx.svc(ServiceType)
  }

  timing (...messages: string[]) {
    return this.ctx.timing(...messages)
  }

  async removeUnauthorized (objects: T[]) {
    return await filterAsync(objects, async obj => await this.mayView(obj))
  }

  abstract mayView (obj: T): Promise<boolean>
}
