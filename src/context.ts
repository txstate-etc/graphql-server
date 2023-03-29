import { createPublicKey, createSecretKey, KeyObject } from 'crypto'
import { DataLoaderFactory } from 'dataloader-factory'
import { FastifyRequest } from 'fastify'
import { createRemoteJWKSet, decodeJwt, JWTPayload, jwtVerify, JWTVerifyGetKey } from 'jose'
import { Cache, toArray } from 'txstate-utils'
import { AuthError } from './errors'
import { BaseService } from './service'

export type Type<T> = new (...args: any[]) => T

export function cleanPem (secretOrPem: string | undefined) {
  return secretOrPem?.replace(/(-+BEGIN [\w\s]+ KEY-+)\s*(.*?)\s*(-+END [\w\s]+ KEY-+)/, '$1\n$2\n$3')
}

export class MockContext<AuthType = any> {
  public auth?: AuthType
  protected serviceInstances: Map<any, any>
  public loaders: DataLoaderFactory<this>
  private static executeQuery: (ctx: MockContext, query: string, variables: any, operationName?: string) => Promise<any>

  constructor (auth: any) {
    this.loaders = new DataLoaderFactory(this)
    this.serviceInstances = new Map()
    this.auth = auth
  }

  async waitForAuth () {}

  static init () {}

  svc <T extends BaseService> (ServiceType: Type<T>) {
    if (!this.serviceInstances.has(ServiceType)) this.serviceInstances.set(ServiceType, new ServiceType(this))
    return this.serviceInstances.get(ServiceType) as T
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

  async query <T> (query: string, variables?: any): Promise<T> {
    return await MockContext.executeQuery(this, query, variables) as T
  }
}

export class Context<AuthType = any> extends MockContext<AuthType> {
  private authPromise: Promise<AuthType | undefined> | AuthType | undefined
  protected static jwtVerifyKey: KeyObject | undefined
  protected static issuerKeys = new Map<string, JWTVerifyGetKey | KeyObject>()

  protected static tokenCache = new Cache(async (token: string, { req, ctx }: { req?: FastifyRequest, ctx: Context }) => {
    const logger = req?.log ?? console
    let verifyKey: KeyObject | JWTVerifyGetKey | undefined = Context.jwtVerifyKey
    try {
      const claims = decodeJwt(token)
      if (claims.iss && Context.issuerKeys.has(claims.iss)) verifyKey = Context.issuerKeys.get(claims.iss)
      if (!verifyKey) {
        logger.info('Received token with issuer:', claims.iss, 'but JWT secret could not be found. The server may be misconfigured or the user may have presented a JWT from an untrusted issuer.')
        return undefined
      }
      const { payload } = await jwtVerify(token, verifyKey as any)
      return await ctx.authFromPayload(payload)
    } catch (e: any) {
      // squelch errors about bad tokens, we can already see the 401 in the log
      if (e.code !== 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED') logger.error(e)
      return undefined
    }
  }, { freshseconds: 10 })

  constructor (req?: FastifyRequest) {
    super(undefined)
    this.authPromise = this.authFromReq(req)
  }

  async waitForAuth () {
    this.auth = await this.authPromise
  }

  static init () {
    let secret = cleanPem(process.env.JWT_SECRET_VERIFY)
    if (secret != null) {
      this.jwtVerifyKey = createPublicKey(secret)
    } else {
      secret = cleanPem(process.env.JWT_SECRET)
      if (secret != null) {
        try {
          this.jwtVerifyKey = createPublicKey(secret)
        } catch (e: any) {
          console.info('JWT_SECRET was not a private key, treating it as symmetric.')
          this.jwtVerifyKey = createSecretKey(Buffer.from(secret, 'ascii'))
        }
      }
    }
    if (process.env.JWT_TRUSTED_ISSUERS) {
      const issuers = toArray(JSON.parse(process.env.JWT_TRUSTED_ISSUERS))
      for (const issuer of issuers) {
        if (issuer.url) Context.issuerKeys.set(issuer.iss, createRemoteJWKSet(new URL(issuer.url)))
        else if (issuer.publicKey) Context.issuerKeys.set(issuer.iss, createPublicKey(issuer.publicKey))
        else if (issuer.secret) Context.issuerKeys.set(issuer.iss, createSecretKey(Buffer.from(issuer.secret, 'ascii')))
      }
    }
  }

  tokenFromReq (req?: FastifyRequest) {
    const m = req?.headers.authorization?.match(/^bearer (.*)$/i)
    return m?.[1]
  }

  async authFromReq (req?: FastifyRequest): Promise<AuthType | undefined> {
    const token = this.tokenFromReq(req)
    if (!token) return undefined
    return await Context.tokenCache.get(token, { req, ctx: this })
  }

  async authFromPayload (payload: JWTPayload) {
    return payload as unknown as AuthType
  }
}
