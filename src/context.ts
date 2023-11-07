import { createPublicKey, createSecretKey, type KeyObject } from 'crypto'
import { DataLoaderFactory } from 'dataloader-factory'
import { type FastifyRequest } from 'fastify'
import { createRemoteJWKSet, decodeJwt, type JWTPayload, jwtVerify, type JWTVerifyGetKey } from 'jose'
import { Cache, omit, toArray } from 'txstate-utils'
import { AuthError } from './errors'
import { type BaseService } from './service'

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
  protected static issuerConfig = new Map<string, any>()

  protected static tokenCache = new Cache(async (token: string, { req, ctx }: { req?: FastifyRequest, ctx: Context }) => {
    const logger = req?.log ?? console
    let verifyKey: KeyObject | JWTVerifyGetKey | undefined = this.jwtVerifyKey
    try {
      const claims = decodeJwt(token)
      if (claims.iss && this.issuerKeys.has(claims.iss)) verifyKey = this.issuerKeys.get(claims.iss)
      if (!verifyKey) {
        logger.info('Received token with issuer:', claims.iss, 'but JWT secret could not be found. The server may be misconfigured or the user may have presented a JWT from an untrusted issuer.')
        return undefined
      }
      await this.validateToken?.(token, this.issuerConfig.get(claims.iss!), claims)
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
        this.issuerConfig.set(issuer.iss, this.processIssuerConfig?.(omit(issuer, 'publicKey', 'secret')))
        if (issuer.url) this.issuerKeys.set(issuer.iss, createRemoteJWKSet(new URL(issuer.url)))
        else if (issuer.publicKey) this.issuerKeys.set(issuer.iss, createPublicKey(issuer.publicKey))
        else if (issuer.secret) this.issuerKeys.set(issuer.iss, createSecretKey(Buffer.from(issuer.secret, 'ascii')))
      }
    }
  }

  /**
   * If implemented, this method will be called on startup, once per configured issuer. It receives
   * the issuer configuration from the JWT_TRUSTED_ISSUERS environment variable and allows you to manipulate
   * the configuration before storing it.
   *
   * Once stored, whatever you create may be used in your custom validateToken method. For example,
   * you might want to create an in-memory URL object with an issuer's URL so that it can be manipulated
   * easily to send validation checks to the issuer.
   */
  static processIssuerConfig: undefined | ((config: any) => any)

  /**
   * If implemented, this method is called after a token's signature is checked and passes. You would
   * typically implement this method to check whether the user has manually signed out, or the token has
   * been otherwise deauthorized before its expiration date.
   *
   * If the token is not valid, this method should throw an error with an appropriate message.
   */
  static validateToken: undefined | ((token: string, issuerConfig: any, claims: JWTPayload) => void | Promise<void>)

  tokenFromReq (req?: FastifyRequest) {
    const m = req?.headers.authorization?.match(/^bearer (.*)$/i)
    return m?.[1]
  }

  async authFromReq (req?: FastifyRequest): Promise<AuthType | undefined> {
    const token = this.tokenFromReq(req)
    if (!token) return undefined
    return await (this.constructor as typeof Context).tokenCache.get(token, { req, ctx: this })
  }

  async authFromPayload (payload: JWTPayload) {
    return payload as unknown as AuthType
  }
}

export class TxStateUAuthContext extends Context {
  static processIssuerConfig (config: any) {
    if (config.iss === 'unified-auth') {
      config.validateUrl = new URL(config.url)
      config.validateUrl.pathname = '/validateToken'
    }
    return config
  }

  static async validateToken (token: string, issuerConfig: any, claims: any) {
    if (claims.iss === 'unified-auth') {
      const validateUrl = new URL(issuerConfig.validateUrl)
      validateUrl.searchParams.set('unifiedJwt', token)
      const resp = await fetch(validateUrl)
      const validate = await resp.json() as { valid: boolean, reason?: string }
      if (!validate.valid) throw new Error(validate.reason ?? 'Your session has been ended on another device or in another browser tab/window. It\'s also possible your NetID is no longer active.')
    }
  }
}
