import { expect } from 'chai'
import { basicBookQuery, digestBookQuery, nonWhitelistedService, whitelistedService, queryDigest, signAuth, signQueryDigest } from './01.basic'

describe('query digest tests', function () {
  it('should get same list of books with authors multiple times from book digest service with non-whitelisted authn and query digest tokens', async () => {
    const authn = await signAuth(nonWhitelistedService, 'testuser')
    const query = '{ books { title, authors { name } } }'
    const querydigest = queryDigest(nonWhitelistedService, query)
    const signedquerydigest = await signQueryDigest(querydigest)
    const headers: Record<string, string> = { 'x-query-digest': signedquerydigest, Authorization: 'bearer ' + authn }
    const books1 = await digestBookQuery('{ books { title, authors { name } } }', {}, { headers })
    expect(books1.books.length).to.be.greaterThan(0)
    // This tests query digest cache
    const books2 = await digestBookQuery('{ books { title, authors { name } } }', {}, { headers })
    expect(books2.books.length).to.be.greaterThan(0)
    expect(books1.books.length).equals(books2.books.length)
  })
  it('should get a list of books with authors from book digest service. Using a valid whitelisted authn token', async () => {
    const authn = await signAuth(whitelistedService, 'testuser')
    const headers: Record<string, string> = { Authorization: 'bearer ' + authn }
    const { books } = await digestBookQuery('{ books { title, authors { name } } }', {}, { headers })
    expect(books.length).to.be.greaterThan(0)
  })
  it('should get a list of books with authors from basic book service with non-whitelist authn token and query digest token that does NOT match query', async () => {
    const authn = await signAuth(nonWhitelistedService, 'testuser')
    const querydigest = queryDigest(nonWhitelistedService, 'invalid and non-matching query string')
    const signedquerydigest = await signQueryDigest(querydigest)
    const headers: Record<string, string> = { 'x-query-digest': signedquerydigest, Authorization: 'bearer ' + authn }
    // Test was Failing. If server is not setup with JWT key it returns 500;
    // with e.message === 'Internal Server Error'
    // Unless graphql-server code is changed to address this expectation, we
    // will supply it with a JWT key to to make sure it can process requests.
    const { books } = await basicBookQuery('{ books { title, authors { name } } }', {}, { headers })
    expect(books.length).to.be.greaterThan(0)
  })
  it('should get a list of books with authors from digest book service. Using white list auth token but send with bad/non-matching query digest', async () => {
    const authn = await signAuth(whitelistedService, 'testuser')
    const querydigest = queryDigest(whitelistedService, 'invalid and non-matching query string')
    const signedquerydigest = await signQueryDigest(querydigest)
    const headers: Record<string, string> = { 'x-query-digest': signedquerydigest, Authorization: 'bearer ' + authn }
    const { books } = await digestBookQuery('{ books { title, authors { name } } }', {}, { headers })
    expect(books.length).to.be.greaterThan(0)
  })
  it('should get a 401 from book digest service. NO authn NOR query digest tokens', async () => {
    try {
      await digestBookQuery('{ books { title, authors { name } } }')
      expect.fail('should have thrown error')
    } catch (e: any) {
      expect(e.message).to.include('"authenticationError": true')
    }
  })
  it('should get a 400 from book digest service. Using a valid non-whitelisted authn token and NO query digest token', async () => {
    const authn = await signAuth(nonWhitelistedService, 'testuser')
    const headers: Record<string, string> = { Authorization: 'bearer ' + authn }
    try {
      await digestBookQuery('{ books { title, authors { name } } }', {}, { headers })
      expect.fail('should have thrown error')
    } catch (e: any) {
      expect(e.message).to.include('request requires signed query digest')
    }
  })
  //
  it('should get a 401 from digest book service. NO authn token with a valid query digest token', async () => {
    const query = '{ books { title, authors { name } } }'
    const querydigest = queryDigest(whitelistedService, query)
    const signedquerydigest = await signQueryDigest(querydigest)
    const headers: Record<string, string> = { 'x-query-digest': signedquerydigest }
    try {
      await digestBookQuery(query, {}, { headers })
      expect.fail('should have thrown error')
    } catch (e: any) {
      expect(e.message).to.include('"authenticationError": true')
      // expect(e.message).to.include('request requires authentication with client service')
    }
  })
  it('should get a 400 from digest book service. Using an authn token and a query digest token with mismatched client_id', async () => {
    const query = '{ books { title, authors { name } } }'
    const authn = await signAuth(nonWhitelistedService, 'testuser')
    const querydigest = queryDigest(whitelistedService, query)
    const signedquerydigest = await signQueryDigest(querydigest)
    const headers: Record<string, string> = { 'x-query-digest': signedquerydigest, Authorization: 'bearer ' + authn }
    try {
      await digestBookQuery(query, {}, { headers })
      expect.fail('should have thrown error')
    } catch (e: any) {
      expect(e.message).to.include('request contains a mismatched client service or query')
    }
  })
  it('should get a 400 from digest book service. Using an authn token and a query digest token with mismatched query', async () => {
    const query1 = '{ books { title } }'
    const authn = await signAuth(nonWhitelistedService, 'testuser')
    const querydigest = queryDigest(nonWhitelistedService, query1)
    const signedquerydigest = await signQueryDigest(querydigest)
    const headers: Record<string, string> = { 'x-query-digest': signedquerydigest, Authorization: 'bearer ' + authn }
    const query2 = '{ books { title, authors { name } } }'
    try {
      await digestBookQuery(query2, {}, { headers })
      expect.fail('should have thrown error')
    } catch (e: any) {
      expect(e.message).to.include('request contains a mismatched client service or query')
    }
  })
})
