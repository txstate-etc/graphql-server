import type { FastifyRequest } from 'fastify'
import { jwtVerify } from 'jose'
import { createHmac, createPublicKey, type KeyObject } from 'node:crypto'
import type { GQLRequest } from './server.ts'

// https://nodejs.org/api/crypto.html#crypto
export function composeQueryDigest (clientId: string, query: string): string {
  return createHmac('sha256', clientId).update(query).digest('hex')
}

interface JWTQueryDigest {
  qd: string
}

export class QueryDigest {
  // for future reference this public key may allow for rotation with
  // latest list of keys retrieved from a key service.
  protected static jwtQueryPublicKey: KeyObject
  public jwtToken?: string
  public clientQueryDigest?: string

  constructor (req: FastifyRequest<GQLRequest>) {
    this.jwtToken = this.tokenFromReq(req)
  }

  static init () {
    const secret = process.env.JWT_QUERY_DIGEST_PUBLIC_KEY
    if (secret != null) {
      this.jwtQueryPublicKey = createPublicKey(secret)
    } else {
      throw new Error('JWT query signature secret has not been set. The server is misconfigured.')
    }
  }

  tokenFromReq (req: FastifyRequest<GQLRequest>) {
    const token = req.body.extensions?.querySignature
    // If token header is an array then drop as undefined;
    // for security there should only be one x-query-digest header
    if (typeof token === 'string') {
      return token
    } else {
      return undefined
    }
  }

  async getVerifiedDigest (): Promise<string | undefined> {
    if (this.jwtToken) {
      try {
        // NOTE: eventually we may get jwtQueryPublicKey from server via async request.
        const claim = await jwtVerify<JWTQueryDigest>(this.jwtToken, QueryDigest.jwtQueryPublicKey)
        return claim.payload.qd
      } catch (e) {
        // Treat token with invalid signature as if token doesn't exist
        // but log failure signature validation.
        // eslint-disable-next-line no-console -- log signature validation failures
        console.error(e)
        return undefined
      }
    } else {
      return undefined
    }
  }
}
