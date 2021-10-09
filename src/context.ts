import { DataLoaderFactory } from 'dataloader-factory'
import { FastifyRequest } from 'fastify'
import jwt from 'jsonwebtoken'
import { AuthError } from './errors'
import { BaseService } from './service'

export type Type<T> = new (...args: any[]) => T

export class Context<AuthType = any> {
  private authPromise: Promise<AuthType|undefined>|AuthType|undefined
  public auth?: AuthType
  protected serviceInstances: Map<string, any>
  public loaders: DataLoaderFactory<Context>
  protected jwtVerifyKey: string|undefined = process.env.JWT_SECRET_VERIFY ?? process.env.JWT_SECRET

  constructor (req?: FastifyRequest) {
    this.loaders = new DataLoaderFactory(this)
    this.serviceInstances = new Map()
    this.authPromise = this.authFromReq(req)
  }

  tokenFromReq (req?: FastifyRequest) {
    const m = req?.headers.authorization?.match(/^bearer (.*)$/i)
    return m?.[1]
  }

  authFromReq (req?: FastifyRequest): AuthType|Promise<AuthType>|undefined {
    const token = this.tokenFromReq(req)
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

  async waitForAuth () {
    this.auth = await this.authPromise
  }

  svc <T extends BaseService> (ServiceType: Type<T>) {
    if (!this.serviceInstances.has(ServiceType.name)) this.serviceInstances.set(ServiceType.name, new ServiceType(this))
    return this.serviceInstances.get(ServiceType.name) as T
  }

  private lasttime?: Date
  timing (...messages: string[]) {
    const now = new Date()
    console.debug(now.getTime() - (this.lasttime ?? now).getTime(), ...messages)
    this.lasttime = now
  }

  requireAuth () {
    if (this.auth == null) throw new AuthError()
  }
}
