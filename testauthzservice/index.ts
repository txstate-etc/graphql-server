import { GQLServer } from '../src'
import { PersonResolver } from './person/person.resolver'
import { MeetingResolver } from './meeting/meeting.resolver'

const server = new GQLServer()

server.start({
  resolvers: [PersonResolver, MeetingResolver],
  federated: !process.env.WITHOUT_FEDERATION
}).catch(console.error)
