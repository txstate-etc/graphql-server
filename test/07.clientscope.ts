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

describe('default scope functions', () => {
  it('should allow a whitelist client to read the fields within its scope', async () => {
    const data = await authzQuery('{ people { id, name } }', {}, await authHeaders('scoped-default-reader'))
    expect(data.people.length).to.be.greaterThan(0)
    expect(data.people[0].name).to.be.a('string')
  })

  it('should reject a whitelist client requesting a field outside its scope', async () => {
    try {
      await authzQuery('{ people { id, contact } }', {}, await authHeaders('scoped-default-reader'))
      expect.fail('should have thrown a scope error')
    } catch (e: any) {
      expect(e.message).to.include('Person.contact')
    }
  })

  it('should allow every field of a type whitelisted with an empty set', async () => {
    const data = await authzQuery('{ meetings { id, title } }', {}, await authHeaders('scoped-default-typeonly'))
    expect(data.meetings.length).to.be.greaterThan(0)
    expect(data.meetings[0].title).to.be.a('string')
  })

  it('should still deny types absent from the allowed map, even reached through a whitelisted type', async () => {
    try {
      await authzQuery('{ meetings { people { id } } }', {}, await authHeaders('scoped-default-typeonly'))
      expect.fail('should have thrown a scope error')
    } catch (e: any) {
      expect(e.message).to.include('Person')
    }
  })

  it('should deny a __typename-only selection on a type absent from the allowed map', async () => {
    // without the type-level check this would execute and reveal how many people each meeting has
    try {
      await authzQuery('{ meetings { people { __typename } } }', {}, await authHeaders('scoped-default-typeonly'))
      expect.fail('should have thrown a scope error')
    } catch (e: any) {
      expect(e.message).to.include('Person')
    }
  })

  it('should allow a blacklist client to read everything not disallowed', async () => {
    const data = await authzQuery('{ people { id, name, meetings { title } } }', {}, await authHeaders('scoped-default-blacklist'))
    expect(data.people.length).to.be.greaterThan(0)
  })

  it('should reject a blacklist client requesting a disallowed field', async () => {
    try {
      await authzQuery('{ people { id, contact } }', {}, await authHeaders('scoped-default-blacklist'))
      expect.fail('should have thrown a scope error')
    } catch (e: any) {
      expect(e.message).to.include('Person.contact')
    }
  })

  it('should reject a blacklist client requesting a disallowed root field', async () => {
    try {
      await authzQuery('{ meetings { id, title } }', {}, await authHeaders('scoped-default-blacklist'))
      expect.fail('should have thrown a scope error')
    } catch (e: any) {
      expect(e.message).to.include('Query.meetings')
    }
  })

  it('should reject a type-banned client no matter which field returns the type', async () => {
    // directly via Query.people
    try {
      await authzQuery('{ people { id } }', {}, await authHeaders('scoped-default-notype'))
      expect.fail('should have thrown a scope error')
    } catch (e: any) {
      expect(e.message).to.include('Person')
    }
    // indirectly via Meeting.people
    try {
      await authzQuery('{ meetings { people { id } } }', {}, await authHeaders('scoped-default-notype'))
      expect.fail('should have thrown a scope error')
    } catch (e: any) {
      expect(e.message).to.include('Person')
    }
  })

  it('should still allow a type-banned client to read other types', async () => {
    const data = await authzQuery('{ meetings { id, title } }', {}, await authHeaders('scoped-default-notype'))
    expect(data.meetings.length).to.be.greaterThan(0)
  })

  it('should leave a client with two empty maps unrestricted', async () => {
    const data = await authzQuery('{ people { id, name, contact }, meetings { title } }', {}, await authHeaders('scoped-default-empty'))
    expect(data.people.length).to.be.greaterThan(0)
    expect(data.meetings.length).to.be.greaterThan(0)
  })

  it('should allow a multi-group client anything that any of its groups allows', async () => {
    // meetings come from group 1 (everything except Person), names from group 2 (Person id/name only)
    const data = await authzQuery('{ meetings { id, title }, people { id, name } }', {}, await authHeaders('scoped-default-multigroup'))
    expect(data.meetings.length).to.be.greaterThan(0)
    expect(data.people.length).to.be.greaterThan(0)
  })

  it('should deny a multi-group client anything that every group denies', async () => {
    // group 1 bans the Person type, group 2 whitelists only id and name, so contact stays denied
    try {
      await authzQuery('{ people { id, contact } }', {}, await authHeaders('scoped-default-multigroup'))
      expect.fail('should have thrown a scope error')
    } catch (e: any) {
      expect(e.message).to.include('Person.contact')
    }
  })

  it('should deny everything to a client with an empty array of groups', async () => {
    try {
      await authzQuery('{ people { id } }', {}, await authHeaders('scoped-default-nogroups'))
      expect.fail('should have thrown a scope error')
    } catch (e: any) {
      expect(e.message).to.include('is not within the scope')
    }
  })

  it('should fail closed when scope data does not match DefaultScopeData', async () => {
    try {
      await authzQuery('{ people { id } }', {}, await authHeaders('scoped-default-malformed'))
      expect.fail('should have thrown a scope error')
    } catch (e: any) {
      // the type check runs before the field check, so the malformed shape denies Person first
      expect(e.message).to.include('is not within the scope')
    }
  })
})

describe('default scope introspection filtering', () => {
  it('should hide disallowed fields from a blacklist client introspecting a type', async () => {
    const data = await authzQuery('{ __type(name: "Person") { fields { name } } }', {}, await authHeaders('scoped-default-blacklist'))
    const fieldNames = data.__type.fields.map((f: { name: string }) => f.name)
    expect(fieldNames).to.include('name')
    expect(fieldNames).to.not.include('contact')
  })

  it('should hide a banned type entirely from introspection', async () => {
    const data = await authzQuery('{ __type(name: "Person") { fields { name } } }', {}, await authHeaders('scoped-default-notype'))
    expect(data.__type).to.equal(null)
  })

  it('should hide a type absent from a whitelist entirely from introspection', async () => {
    const data = await authzQuery('{ __type(name: "Meeting") { fields { name } } }', {}, await authHeaders('scoped-default-reader'))
    expect(data.__type).to.equal(null)
  })
})

describe('defaultScopeDataFromRows clients', () => {
  it('should let a rows-built blacklist client read everything except the disallowed row', async () => {
    const data = await authzQuery('{ people { id, name }, meetings { title } }', {}, await authHeaders('scoped-rows-blacklist'))
    expect(data.people.length).to.be.greaterThan(0)
    expect(data.meetings.length).to.be.greaterThan(0)
  })

  it('should reject the field named by a disallow row', async () => {
    try {
      await authzQuery('{ people { id, contact } }', {}, await authHeaders('scoped-rows-blacklist'))
      expect.fail('should have thrown a scope error')
    } catch (e: any) {
      expect(e.message).to.include('Person.contact')
    }
  })

  it('should let a whole-type row cover every field, even with a competing field row first', async () => {
    // if the field row won, only Meeting.title would be allowed and id would be rejected
    const data = await authzQuery('{ meetings { id, title } }', {}, await authHeaders('scoped-rows-wholetype'))
    expect(data.meetings.length).to.be.greaterThan(0)
  })

  it('should leave a client with zero rows unrestricted', async () => {
    const data = await authzQuery('{ people { id, contact } }', {}, await authHeaders('scoped-rows-norows'))
    expect(data.people.length).to.be.greaterThan(0)
  })

  it('should treat an unrecognized allowOrDisallow value as disallow', async () => {
    // if 'Allow' were counted as allow it would create a whitelist and this query would be rejected
    const data = await authzQuery('{ people { id, name } }', {}, await authHeaders('scoped-rows-badvalue'))
    expect(data.people.length).to.be.greaterThan(0)
    try {
      await authzQuery('{ people { contact } }', {}, await authHeaders('scoped-rows-badvalue'))
      expect.fail('should have thrown a scope error')
    } catch (e: any) {
      expect(e.message).to.include('Person.contact')
    }
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
