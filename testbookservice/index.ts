import { GQLServer } from '../src'
import { AuthorResolver } from './author/author.resolver'
import { BookResolver } from './book/book.resolver'

const server = new GQLServer()

server.start({
  resolvers: [AuthorResolver, BookResolver],
  federated: !process.env.WITHOUT_FEDERATION
}).catch(console.error)
