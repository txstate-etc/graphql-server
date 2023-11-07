// import { expect } from 'chai'
// import { QueryScope } from 'queryscope'
// import { basicBookQuery, digestBookQuery, clientId, whitelistedClientId, queryDigest, signAuth, signQueryDigest } from './01.basic'

// describe('query digest tests', function () {
//   it('should get same list of books with authors multiple times from book digest service with non-whitelisted authn and query digest tokens', async () => {
//     const authn = await signAuth(clientId, 'testuser')
//     // Let queryscope transformer generate token for query
//     const gq: QueryScope = { query: '{ books { title, authors { name } } }' }
//     const headers: Record<string, string> = { Authorization: 'bearer ' + authn }
//     const books1 = await digestBookQuery(gq.query, {}, { headers }, gq.token)
//     expect(books1.books.length).to.be.greaterThan(0)
//     // This tests query digest cache
//     const books2 = await digestBookQuery(gq.query, {}, { headers }, gq.token)
//     expect(books2.books.length).to.be.greaterThan(0)
//     expect(books1.books.length).equals(books2.books.length)
//   })
//   it('should get a list of books with authors from book digest service. Using a valid whitelisted authn token', async () => {
//     const authn = await signAuth(whitelistedClientId, 'testuser')
//     const headers: Record<string, string> = { Authorization: 'bearer ' + authn }
//     const { books } = await digestBookQuery('{ books { title, authors { name } } }', {}, { headers })
//     expect(books.length).to.be.greaterThan(0)
//   })
//   it('should get a list of books with authors from basic book service with non-whitelist authn token and query digest token that does NOT match query', async () => {
//     const authn = await signAuth(clientId, 'testuser')
//     const headers: Record<string, string> = { Authorization: 'bearer ' + authn }
//     // Let queryscope transformer generate token for query
//     const gq: QueryScope = { query: 'invalid and non-matching query string' }
//     // Test was Failing. If server is not setup with JWT key it returns 500;
//     // with e.message === 'Internal Server Error'
//     // Unless graphql-server code is changed to address this expectation, we
//     // will supply it with a JWT key to to make sure it can process requests.
//     const { books } = await basicBookQuery('{ books { title, authors { name } } }', {}, { headers }, gq.token)
//     expect(books.length).to.be.greaterThan(0)
//   })
//   it('should get a list of books with authors from digest book service. Using white list auth token but send with bad/non-matching query digest', async () => {
//     const authn = await signAuth(whitelistedClientId, 'testuser')
//     const headers: Record<string, string> = { Authorization: 'bearer ' + authn }
//     const querydigest = queryDigest(whitelistedClientId, 'invalid and non-matching query string')
//     const signedquerydigest = await signQueryDigest(querydigest)
//     const { books } = await digestBookQuery('{ books { title, authors { name } } }', {}, { headers }, signedquerydigest)
//     expect(books.length).to.be.greaterThan(0)
//   })
//   it('should get a 401 from book digest service. NO authn NOR query digest tokens', async () => {
//     try {
//       await digestBookQuery('{ books { title, authors { name } } }')
//       expect.fail('should have thrown error')
//     } catch (e: any) {
//       expect(e.message).to.include('"authenticationError": true')
//     }
//   })
//   it('should get a 400 from book digest service. Using a valid non-whitelisted authn token and NO query digest token', async () => {
//     const authn = await signAuth(clientId, 'testuser')
//     const headers: Record<string, string> = { Authorization: 'bearer ' + authn }
//     try {
//       await digestBookQuery('{ books { title, authors { name } } }', {}, { headers })
//       expect.fail('should have thrown error')
//     } catch (e: any) {
//       expect(e.message).to.include('request requires signed query digest')
//     }
//   })
//   //
//   it('should get a 401 from digest book service. NO authn token with a valid query digest token', async () => {
//     const headers: Record<string, string> = {}
//     const query = '{ books { title, authors { name } } }'
//     const querydigest = queryDigest(whitelistedClientId, query)
//     const signedquerydigest = await signQueryDigest(querydigest)
//     try {
//       await digestBookQuery(query, {}, { headers }, signedquerydigest)
//       expect.fail('should have thrown error')
//     } catch (e: any) {
//       expect(e.message).to.include('"authenticationError": true')
//       // expect(e.message).to.include('request requires authentication with client service')
//     }
//   })
//   it('should get a 400 from digest book service. Using an authn token and a query digest token with mismatched client_id', async () => {
//     // authentication for non-whitelited ClientID
//     const authn = await signAuth(clientId, 'testuser')
//     const headers: Record<string, string> = { Authorization: 'bearer ' + authn }
//     // query scoping for whitelisted ClientId
//     const query = '{ books { title, authors { name } } }'
//     const querydigest = queryDigest(whitelistedClientId, query)
//     const signedquerydigest = await signQueryDigest(querydigest)
//     try {
//       await digestBookQuery(query, {}, { headers }, signedquerydigest)
//       expect.fail('should have thrown error')
//     } catch (e: any) {
//       expect(e.message).to.include('request contains a mismatched client service or query')
//     }
//   })
//   it('should get a 400 from digest book service. Using an authn token and a query digest token with mismatched query', async () => {
//     const authn = await signAuth(clientId, 'testuser')
//     const headers: Record<string, string> = { Authorization: 'bearer ' + authn }
//     // Let queryscope transformer generate token for query
//     const gq: QueryScope = { query: '{ books { title } }' }
//     const mismatchedQuery = '{ books { title, authors { name } } }'
//     try {
//       await digestBookQuery(mismatchedQuery, {}, { headers }, gq.token)
//       expect.fail('should have thrown error')
//     } catch (e: any) {
//       expect(e.message).to.include('request contains a mismatched client service or query')
//     }
//   })
// })
