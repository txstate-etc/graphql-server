import axios, { AxiosInstance } from 'axios'
import { expect } from 'chai'

const bookclient = axios.create({
  baseURL: 'http://bookservice'
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

async function gqlQuery<T> (client: AxiosInstance, query: string, variables?: any) {
  try {
    const resp = await client.post<any>('graphql', {
      query,
      ...(variables ? { variables } : {})
    })
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
export async function basicBookQuery<T = any> (query: string, variables?: any) {
  return await gqlQuery<T>(basicbookclient, query, variables)
}
export async function libraryQuery<T = any> (query: string, variables?: any) {
  return await gqlQuery<T>(libraryclient, query, variables)
}
export async function gatewayQuery<T = any> (query: string, variables?: any) {
  return await gqlQuery<T>(gatewayclient, query, variables)
}

before(async () => {
  await new Promise(resolve => setTimeout(resolve, 1000))
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
