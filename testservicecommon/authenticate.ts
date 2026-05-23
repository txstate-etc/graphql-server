import { createSecretKey } from 'node:crypto'
import type { FastifyRequest } from 'fastify'
import type { FastifyTxStateAuthInfo } from 'fastify-txstate'
import { jwtVerify } from 'jose'

const jwtSecret = process.env.JWT_SECRET
const sharedKey = jwtSecret ? createSecretKey(Buffer.from(jwtSecret, 'ascii')) : undefined

export async function authenticate (req: FastifyRequest): Promise<FastifyTxStateAuthInfo | undefined> {
  if (sharedKey == null) return undefined
  const authHeader = req.headers.authorization
  if (authHeader == null) return undefined
  const match = /^bearer\s+(.+)$/i.exec(authHeader)
  if (match == null) return undefined
  const token = match[1]
  const { payload } = await jwtVerify(token, sharedKey, { issuer: 'unified-auth' })
  const username = String(payload.sub ?? '')
  return {
    username,
    sessionId: `${username}-${String(payload.iat ?? 0)}`,
    token,
    clientId: typeof payload.client_id === 'string' ? payload.client_id : undefined
  }
}
