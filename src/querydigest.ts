import { FastifyRequest } from 'fastify'
import { jwtVerify, KeyLike } from 'jose'
import { createHmac, createPublicKey } from 'crypto'

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
  protected jwtQueryPublicKey: KeyLike
  public jwtToken?: string
  public clientQueryDigest?: string

  constructor (req?: FastifyRequest) {
    const secret = process.env.JWT_QUERY_DIGEST_PUBLIC_KEY
    if (secret != null) {
      this.jwtQueryPublicKey = createPublicKey(secret)
    } else {
      throw new Error('JWT query signature secret has not been set. The server is misconfigured.')
    }
    this.jwtToken = this.tokenFromReq(req)
  }

  tokenFromReq (req?: FastifyRequest) {
    const token = req?.headers['x-query-digest']
    // If token header is an array then drop as undefined;
    // for security there should only be one x-query-digest header
    if (typeof token === 'string') {
      return token
    } else {
      return undefined
    }
  }

  async getVerifiedDigest (): Promise<string|undefined> {
    if (this.jwtToken) {
      try {
        // NOTE: eventually we may get jwtQueryPublicKey from server via async request.
        const claim = await jwtVerify(this.jwtToken, this.jwtQueryPublicKey) as any
        const payload = claim.payload as unknown as JWTQueryDigest
        return payload.qd
      } catch (e) {
        // Treat token with invalid signature as if token doesn't exist
        // but log failure signature validation.
        console.error(e)
        return undefined
      }
    } else {
      return undefined
    }
  }
}