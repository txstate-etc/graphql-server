import { createPublicKey, createSecretKey, KeyObject } from 'crypto'
import { DataLoaderFactory } from 'dataloader-factory'
import { FastifyRequest } from 'fastify'
import { jwtVerify } from 'jose'
import { AuthError } from './errors'
import { BaseService } from './service'
// import { createSecretKey } from 'crypto'

export type Type<T> = new (...args: any[]) => T

export class Context<AuthType = any> {
  private authPromise: Promise<AuthType|undefined>|AuthType|undefined
  public auth?: AuthType
  protected serviceInstances: Map<string, any>
  public loaders: DataLoaderFactory<Context>
  protected jwtVerifyKey: KeyObject|undefined
  // app is usually the client_id field pulled from that Authentication bearer
  // jwt token, but can be any field that identifies the service making the
  // request on behalf of the user.

  constructor (req?: FastifyRequest) {
    let secret = process.env.JWT_SECRET_VERIFY
    if (secret != null) {
      this.jwtVerifyKey = createPublicKey(secret)
    } else {
      secret = process.env.JWT_SECRET
      if (secret != null) {
        this.jwtVerifyKey = createSecretKey(Buffer.from(secret, 'base64'))
      }
    }
    this.loaders = new DataLoaderFactory(this)
    this.serviceInstances = new Map()
    this.authPromise = this.authFromReq(req)
  }

  tokenFromReq (req?: FastifyRequest) {
    const m = req?.headers.authorization?.match(/^bearer (.*)$/i)
    return m?.[1]
  }

  async authFromReq (req?: FastifyRequest): Promise<AuthType|undefined> {
    const token = this.tokenFromReq(req)
    if (token) {
      if (!this.jwtVerifyKey) {
        console.log('Received token from user. JWT secret has not been set. The server may be misconfigured.')
        return undefined
      }
      try {
        const payload = await jwtVerify(token, this.jwtVerifyKey) as any
        return payload.payload as unknown as AuthType
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
