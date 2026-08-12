import { GQLServer, defaultClientScope, type DefaultScopeData } from '../src/index.ts'
import { authenticate } from '../testservicecommon/authenticate.ts'
import { PersonResolver } from './person/person.resolver.ts'
import { MeetingResolver } from './meeting/meeting.resolver.ts'

const server = new GQLServer({ authenticate })

/**
 * Client scoping fixture. Clients in this map are restricted; everyone else is
 * unrestricted so the pre-existing authz tests are unaffected. 'scoped-reader' keeps
 * coverage on custom string denial reasons; the 'scoped-default-*' clients are routed
 * through defaultClientScope.
 */
interface AuthzScope { fields: Set<string> }
const scopedClients: Record<string, AuthzScope | DefaultScopeData> = {
  'scoped-reader': {
    // may read people's id and name, but not their contact info, and may not touch meetings at all
    fields: new Set(['Query.people', 'Person.id', 'Person.name'])
  },
  'scoped-default-reader': {
    // same grants as scoped-reader, expressed as a DefaultScopeData whitelist
    allowed: new Map([
      ['Query', new Set(['people'])],
      ['Person', new Set(['id', 'name'])]
    ]),
    disallowed: new Map()
  },
  'scoped-default-typeonly': {
    // whole-type whitelist: an empty set grants every Meeting field, but Person isn't granted at all
    allowed: new Map([
      ['Query', new Set(['meetings'])],
      ['Meeting', new Set<string>()]
    ]),
    disallowed: new Map()
  },
  'scoped-default-blacklist': {
    // everything except contact info and the meetings root query
    allowed: new Map(),
    disallowed: new Map([
      ['Person', new Set(['contact'])],
      ['Query', new Set(['meetings'])]
    ])
  },
  'scoped-default-notype': {
    // everything except the Person type, no matter which field returns it
    allowed: new Map(),
    disallowed: new Map([['Person', new Set<string>()]])
  },
  'scoped-default-empty': {
    // two empty maps: an unrestricted client
    allowed: new Map(),
    disallowed: new Map()
  },
  // deliberately malformed ('allow' instead of 'allowed'); the defaults must fail closed
  'scoped-default-malformed': { allow: new Map() } as unknown as DefaultScopeData
}

server.start<AuthzScope | DefaultScopeData | undefined>({
  resolvers: [PersonResolver, MeetingResolver],
  federated: !process.env.WITHOUT_FEDERATION,
  loadScopeData: async clientId => (clientId != null ? scopedClients[clientId] : undefined),
  fieldIsInScope: params => {
    const { scopeData, typeName, fieldName } = params
    if (scopeData == null) return true // unscoped clients are unrestricted
    if ('fields' in scopeData) {
      if (scopeData.fields.has(`${typeName}.${fieldName}`)) return true
      return `client may not access ${typeName}.${fieldName}`
    }
    return defaultClientScope.fieldIsInScope(params)
  },
  typeIsInScope: params => {
    const { scopeData } = params
    if (scopeData == null || 'fields' in scopeData) return true
    return defaultClientScope.typeIsInScope(params)
  }
}).catch(console.error)
