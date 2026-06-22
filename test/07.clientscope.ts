import { describe, it } from 'node:test'
import { expect } from 'chai'
import { signAuth, authzQuery, bookQuery } from './01.basic.ts'

async function authHeaders (clientId: string, user = '1') {
  const authn = await signAuth(clientId, user)
  return { headers: { Authorization: 'bearer ' + authn } }
}

describe('client scope runtime checks', () => {
  it('should allow a scoped client to read the fields within its scope', async () => {
    const data = await authzQuery('{ people { id, name } }', {}, await authHeaders('scoped-reader'))
    expect(data.people.length).to.be.greaterThan(0)
    expect(data.people[0].name).to.be.a('string')
  })

  it('should reject with a 400 when a scoped client requests a field outside its scope', async () => {
    try {
      await authzQuery('{ people { id, contact } }', {}, await authHeaders('scoped-reader'))
      expect.fail('should have thrown a scope error')
    } catch (e: any) {
      expect(e.message).to.include('Person.contact')
    }
  })

  it('should reject with a 400 when a scoped client requests a root field outside its scope', async () => {
    try {
      await authzQuery('{ meetings { id, title } }', {}, await authHeaders('scoped-reader'))
      expect.fail('should have thrown a scope error')
    } catch (e: any) {
      expect(e.message).to.include('Query.meetings')
    }
  })

  it('should leave unscoped clients unrestricted', async () => {
    const data = await authzQuery('{ people { id, name, contact } }', {}, await authHeaders('client_service_test', '4'))
    expect(data.people.length).to.equal(1)
    expect(data.people[0].contact).to.equal('Contact Four')
  })
})

describe('client scope introspection filtering', () => {
  const typeFieldsQuery = '{ __type(name: "Person") { fields { name } } }'
  const queryFieldsQuery = '{ __type(name: "Query") { fields { name } } }'

  it('should hide out-of-scope fields from a scoped client introspecting a type', async () => {
    const data = await authzQuery(typeFieldsQuery, {}, await authHeaders('scoped-reader'))
    const fieldNames = data.__type.fields.map((f: { name: string }) => f.name)
    expect(fieldNames).to.include('id')
    expect(fieldNames).to.include('name')
    expect(fieldNames).to.not.include('contact')
  })

  it('should hide out-of-scope root fields from a scoped client introspecting Query', async () => {
    const data = await authzQuery(queryFieldsQuery, {}, await authHeaders('scoped-reader'))
    const fieldNames = data.__type.fields.map((f: { name: string }) => f.name)
    expect(fieldNames).to.include('people')
    expect(fieldNames).to.not.include('meetings')
  })

  it('should show all fields to an unscoped client introspecting a type', async () => {
    const data = await authzQuery(typeFieldsQuery, {}, await authHeaders('client_service_test'))
    const fieldNames = data.__type.fields.map((f: { name: string }) => f.name)
    expect(fieldNames).to.include('contact')
  })
})

describe('introspection on a service with no client scoping configured', () => {
  // the book service sets neither fieldIsInScope nor typeIsInScope, so client scoping is
  // entirely disabled there; introspection must keep working through the unscoped path.
  it('should return the full schema doc unfiltered', async () => {
    const data = await bookQuery('{ __schema { types { name } } }')
    expect(data.__schema.types.length).to.be.greaterThan(0)
  })

  it('should return every field of a type unfiltered', async () => {
    const data = await bookQuery('{ __type(name: "Book") { fields { name } } }')
    const fieldNames = data.__type.fields.map((f: { name: string }) => f.name)
    expect(fieldNames.length).to.be.greaterThan(0)
    expect(fieldNames).to.include('title')
  })
})
