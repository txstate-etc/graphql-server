import { describe, it } from 'node:test'
import { expect } from 'chai'
import { signAuth, authzQuery } from './01.basic.ts'

// Document has a constructor that requires a DB row and a @Field method (shoutingTitle),
// which type-graphql registers as a field resolver. That combination is where
// prototype-losing clones blow up: type-graphql converts every field resolver root back to
// a Document, and a plain-object root makes it re-run the constructor with no arguments.
// These tests prove cloneModel survives that conversion and pin down the crash you get from
// an object spread instead.
describe('cloneModel redaction', () => {
  it('should resolve field resolvers on cloneModel-redacted objects and null out the redacted field', async () => {
    const authn = await signAuth('client_service_test', '1')
    const data = await authzQuery('{ documents { id secret shoutingTitle } }', {}, { headers: { Authorization: 'bearer ' + authn } })
    const own = data.documents.find((d: any) => d.id === 1)
    const other = data.documents.find((d: any) => d.id === 2)
    expect(own.secret).to.equal('what was really said')
    expect(own.shoutingTitle).to.equal('MEETING MINUTES')
    expect(other.secret).to.equal(null)
    expect(other.shoutingTitle).to.equal('BUDGET')
  })
  it('should not have mutated the cached instance while redacting for other users', async () => {
    const authn = await signAuth('client_service_test', '2')
    const data = await authzQuery('{ documents { id secret } }', {}, { headers: { Authorization: 'bearer ' + authn } })
    expect(data.documents.find((d: any) => d.id === 2).secret).to.equal('we are broke')
  })
  it('documents the trap: a spread clone loses the prototype and crashes field resolution', async () => {
    const authn = await signAuth('client_service_test', '1')
    let message = 'did not throw'
    try {
      await authzQuery('{ documentsSpreadClone { id secret shoutingTitle } }', {}, { headers: { Authorization: 'bearer ' + authn } })
    } catch (e: any) {
      message = e.message
    }
    // the TypeError from re-running the Document constructor with no row
    expect(message).to.match(/cannot read properties of undefined/iv)
  })
})
