import axios, { AxiosInstance, AxiosRequestConfig } from 'axios'
import { expect } from 'chai'
import { sleep } from 'txstate-utils'
import { SignJWT } from 'jose'
import { createHmac, createPrivateKey, createSecretKey } from 'crypto'

export const whitelistedService = 'whitelisted-service-1'
export const nonWhitelistedService = 'non-whitelisted-service'

const bookclient = axios.create({
  baseURL: 'http://bookservice'
})
const digestbookclient = axios.create({
  baseURL: 'http://digestbookservice'
})
const basicbookclient = axios.create({
  baseURL: 'http://basicbookservice'
})
const libraryclient = axios.create({
  baseURL: 'http://libraryservice'
})
const gatewayclient = axios.create({
  baseURL: 'http://gateway'
})

// eslint-disable-next-line @typescript-eslint/naming-convention
export async function signAuth (client_id: string, user: string): Promise<string> {
  const jwtSecret = process.env.JWT_SECRET
  if (jwtSecret == null) throw new Error('JWT secret has not been set. secret is required for testing')
  const sharedKey = createSecretKey(Buffer.from(jwtSecret, 'ascii'))
  return await new SignJWT({ client_id })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer('unified-auth')
    .setSubject(user)
    .sign(sharedKey)
}

export function queryDigest (clientId: string, query: string) {
  return createHmac('sha256', clientId).update(query).digest('hex')
}

export async function signQueryDigest (digest: string): Promise<string> {
  const jwtPrivateKey = process.env.JWT_QUERY_DIGEST_PRIVATE_KEY
  if (jwtPrivateKey == null) throw new Error('JWT private key has not been set. Private key is required for testing')
  const privateKey = createPrivateKey(jwtPrivateKey)
  return await new SignJWT({ qd: digest })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt()
    .setIssuer('unified-auth')
    .sign(privateKey)
}
async function gqlQuery<T> (client: AxiosInstance, query: string, variables?: any, config?: AxiosRequestConfig) {
  try {
    const resp = await client.post<any>('graphql', {
      query,
      ...(variables ? { variables } : {})
    },
    config)
    if (resp.data.errors?.length) throw new Error(resp.data.errors[0].message)
    return resp.data.data as T
  } catch (e: any) {
    if (!e.response) throw e
    throw new Error(JSON.stringify(e.response.data, undefined, 2))
  }
}
export async function bookQuery<T = any> (query: string, variables?: any) {
  return await gqlQuery<T>(bookclient, query, variables)
}
export async function basicBookQuery<T = any> (query: string, variables?: any, config?: AxiosRequestConfig) {
  return await gqlQuery<T>(basicbookclient, query, variables, config)
}
export async function digestBookQuery<T = any> (query: string, variables?: any, config?: AxiosRequestConfig) {
  return await gqlQuery<T>(digestbookclient, query, variables, config)
}
export async function libraryQuery<T = any> (query: string, variables?: any) {
  return await gqlQuery<T>(libraryclient, query, variables)
}
export async function gatewayQuery<T = any> (query: string, variables?: any) {
  return await gqlQuery<T>(gatewayclient, query, variables)
}

before(async function () {
  // Making sure all services are up in order
  const timeOut = 50000
  let bookUp = false
  let libUp = false
  this.timeout(timeOut)
  const start = new Date()

  while (true) {
    try {
      await basicBookQuery('{ books { title } }')
      console.log('non-federated basic book service is up')
      break
    } catch {
      if (new Date().getTime() - start.getTime() > timeOut) break
      else await sleep(150)
    }
  }

  while (true) {
    try {
      await bookQuery('{ books { title } }')
      bookUp = true
      console.log('book service is up')
      break
    } catch {
      if (new Date().getTime() - start.getTime() > timeOut) break
      else await sleep(150)
    }
  }

  while (true) {
    try {
      const query = '{ books { title } }'
      const authn = await signAuth(whitelistedService, 'testuser')
      const headers: Record<string, string> = { Authorization: 'bearer ' + authn }
      await digestBookQuery(query, {}, { headers })
      console.log('non-federated basic book service is up')
      break
    } catch {
      if (new Date().getTime() - start.getTime() > timeOut) break
      else await sleep(150)
    }
  }

  while (true) {
    try {
      await libraryQuery('{ libraries { id } }')
      libUp = true
      console.log('library service is up')
      break
    } catch {
      if (new Date().getTime() - start.getTime() > timeOut) break
      else await sleep(150)
    }
  }

  while (true) {
    if (libUp && bookUp) {
      try {
        await gatewayQuery('{ books { title } }')
        console.log('gateway service is up')
        break
      } catch {
        if (new Date().getTime() - start.getTime() > timeOut) break
        else await sleep(150)
      }
    }
  }
})

describe('basic tests', function () {
  it('should be able to get a list of books with authors directly from the non-federated book service', async () => {
    const { books } = await basicBookQuery('{ books { title, authors { name } } }')
    expect(books.length).to.be.greaterThan(0)
  })
  it('should get a 401 from an authenticated resolver', async () => {
    try {
      await basicBookQuery('{ books { authTest } }')
      expect.fail('should have thrown error')
    } catch (e: any) {
      expect(e.message).to.include('"authenticationError": true')
    }
  })
  it('should be able to get a list of books with authors directly from the federated book service', async () => {
    const { books } = await bookQuery('{ books { title, authors { name } } }')
    expect(books.length).to.be.greaterThan(0)
  })
  it('should be able to get a list of library ids directly from the federated library service', async () => {
    const { libraries } = await libraryQuery('{ libraries { id } }')
    expect(libraries.length).to.be.greaterThan(0)
  })
})
