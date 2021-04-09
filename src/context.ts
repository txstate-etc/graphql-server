import { DataLoaderFactory } from 'dataloader-factory'
import { FastifyRequest } from 'fastify'
import jwt from 'jsonwebtoken'
import { FieldError } from './errors'
import { BaseService } from './service'

export type Type<T> = new (...args: any[]) => T

export class Context {
  public auth: { username: string }
  public serviceInstances: Record<string, any>
  public dlFactory: DataLoaderFactory<Context>
  public validationErrors: FieldError[] = []
  protected jwtVerifyKey: string|undefined = process.env.JWT_SECRET_VERIFY ?? process.env.JWT_SECRET

  constructor (req?: FastifyRequest) {
    this.dlFactory = new DataLoaderFactory(this)
    const m = req?.headers.authorization?.match(/^bearer (.*)$/i)
    const token = m?.[1]
    if (token) {
      if (!this.jwtVerifyKey) throw new Error('JWT secret has not been set. The server is misconfigured.')
      const payload: any = jwt.verify(token, this.jwtVerifyKey)
      this.auth = {
        username: payload.username
      }
    } else {
      this.auth = { username: 'anonymous' }
    }
    this.serviceInstances = {}
  }

  svc <T extends BaseService> (ServiceType: Type<T>) {
    if (!this.serviceInstances[ServiceType.name]) this.serviceInstances[ServiceType.name] = new ServiceType(this)
    return this.serviceInstances[ServiceType.name] as T
  }

  recordValidationError (field: string, message?: string) {
    this.validationErrors.push({ field, message })
  }

  private lasttime?: Date
  timing (...messages: string[]) {
    const now = new Date()
    console.log(now.getTime() - (this.lasttime ?? now).getTime(), ...messages)
    this.lasttime = now
  }
}
