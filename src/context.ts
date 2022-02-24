import { createPublicKey, createSecretKey, KeyObject } from 'crypto'
import { DataLoaderFactory } from 'dataloader-factory'
import { FastifyRequest } from 'fastify'
import { createRemoteJWKSet, decodeJwt, JWTPayload, jwtVerify, JWTVerifyGetKey } from 'jose'
import { toArray } from 'txstate-utils'
import { AuthError } from './errors'
import { BaseService } from './service'

export type Type<T> = new (...args: any[]) => T

export class Context<AuthType = any> {
  private authPromise: Promise<AuthType|undefined>|AuthType|undefined
  public auth?: AuthType
  protected serviceInstances: Map<string, any>
  public loaders: DataLoaderFactory<Context>
  protected static jwtVerifyKey: KeyObject|undefined
  protected static issuerKeys = new Map<string, JWTVerifyGetKey|KeyObject>()
  // app is usually the client_id field pulled from that Authentication bearer
  // jwt token, but can be any field that identifies the service making the
  // request on behalf of the user.

  constructor (req?: FastifyRequest) {
    this.loaders = new DataLoaderFactory(this)
    this.serviceInstances = new Map()
    this.authPromise = this.authFromReq(req)
  }

  static init () {
    let secret = process.env.JWT_SECRET_VERIFY
    if (secret != null) {
      this.jwtVerifyKey = createPublicKey(secret)
    } else {
      secret = process.env.JWT_SECRET
      if (secret != null) {
        this.jwtVerifyKey = createSecretKey(secret, 'base64')
      }
    }
    if (process.env.JWT_TRUSTED_ISSUERS) {
      const issuers = toArray(JSON.parse(process.env.JWT_TRUSTED_ISSUERS))
      for (const issuer of issuers) {
        if (issuer.url) Context.issuerKeys.set(issuer.iss, createRemoteJWKSet(new URL(issuer.url)))
        else if (issuer.publicKey) Context.issuerKeys.set(issuer.iss, createPublicKey(issuer.publicKey))
      }
    }
  }

  tokenFromReq (req?: FastifyRequest) {
    const m = req?.headers.authorization?.match(/^bearer (.*)$/i)
    return m?.[1]
  }

  async authFromReq (req?: FastifyRequest): Promise<AuthType|undefined> {
    const token = this.tokenFromReq(req)
    if (token) {
      let verifyKey: KeyObject|JWTVerifyGetKey|undefined = Context.jwtVerifyKey
      const claims = decodeJwt(token)
      if (claims.iss && Context.issuerKeys.has(claims.iss)) verifyKey = Context.issuerKeys.get(claims.iss)
      if (!verifyKey) {
        console.info('Received token from user. JWT secret could not be found. The server may be misconfigured.')
        return undefined
      }
      try {
        const { payload } = await jwtVerify(token, verifyKey as any)
        return this.authFromPayload(payload)
      } catch (e) {
        console.error(e)
        return undefined
      }
    } else {
      return undefined
    }
  }

  authFromPayload (payload: JWTPayload) {
    return payload as unknown as AuthType
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
