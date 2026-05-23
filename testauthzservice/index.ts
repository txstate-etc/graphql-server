import { GQLServer } from '../src/index.ts'
import { authenticate } from '../testservicecommon/authenticate.ts'
import { PersonResolver } from './person/person.resolver.ts'
import { MeetingResolver } from './meeting/meeting.resolver.ts'

const server = new GQLServer({ authenticate })

server.start({
  resolvers: [PersonResolver, MeetingResolver],
  federated: !process.env.WITHOUT_FEDERATION
}).catch(console.error)
