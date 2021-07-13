import { DataLoaderFactory } from 'dataloader-factory'
import { FastifyRequest } from 'fastify'
import jwt from 'jsonwebtoken'
import { BaseService } from './service'

export type Type<T> = new (...args: any[]) => T

export class Context<AuthType = any> {
  public auth?: AuthType
  public serviceInstances: Record<string, any>
  public dlFactory: DataLoaderFactory<Context>
  protected jwtVerifyKey: string|undefined = process.env.JWT_SECRET_VERIFY ?? process.env.JWT_SECRET

  constructor (req?: FastifyRequest) {
    this.dlFactory = new DataLoaderFactory(this)
    this.serviceInstances = {}
    this.auth = this.authFromReq(req)
  }

  authFromReq (req?: FastifyRequest) {
    const m = req?.headers.authorization?.match(/^bearer (.*)$/i)
    const token = m?.[1]
    if (token) {
      if (!this.jwtVerifyKey) throw new Error('JWT secret has not been set. The server is misconfigured.')
      try {
        const payload = jwt.verify(token, this.jwtVerifyKey) as unknown as AuthType
        return payload
      } catch (e) {
        console.error(e)
        return undefined
      }
    } else {
      return undefined
    }
  }

  svc <T extends BaseService> (ServiceType: Type<T>) {
    if (!this.serviceInstances[ServiceType.name]) this.serviceInstances[ServiceType.name] = new ServiceType(this)
    return this.serviceInstances[ServiceType.name] as T
  }

  private lasttime?: Date
  timing (...messages: string[]) {
    const now = new Date()
    console.debug(now.getTime() - (this.lasttime ?? now).getTime(), ...messages)
    this.lasttime = now
  }
}
