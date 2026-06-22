import { GQLServer } from '../src/index.ts'
import { authenticate } from '../testservicecommon/authenticate.ts'
import { PersonResolver } from './person/person.resolver.ts'
import { MeetingResolver } from './meeting/meeting.resolver.ts'

const server = new GQLServer({ authenticate })

/**
 * Client scoping fixture for the automated tests. Any client id present in this map is
 * restricted to the listed `Type.field` references; every other client (and unauthenticated
 * requests) is unrestricted so the pre-existing authz tests are unaffected.
 */
interface AuthzScope { fields: Set<string> }
const scopedClients: Record<string, AuthzScope> = {
  'scoped-reader': {
    // may read people's id and name, but not their contact info, and may not touch meetings at all
    fields: new Set(['Query.people', 'Person.id', 'Person.name'])
  }
}

server.start<AuthzScope | undefined>({
  resolvers: [PersonResolver, MeetingResolver],
  federated: !process.env.WITHOUT_FEDERATION,
  loadScopeData: async clientId => (clientId != null ? scopedClients[clientId] : undefined),
  fieldIsInScope: ({ typeName, fieldName, scopeData }) => {
    if (scopeData == null) return true
    if (scopeData.fields.has(`${typeName}.${fieldName}`)) return true
    return `client may not access ${typeName}.${fieldName}`
  }
}).catch(console.error)
