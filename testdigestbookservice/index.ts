import { GQLServer } from '../src'
import { AuthorResolver } from './author/author.resolver'
import { BookResolver } from './book/book.resolver'

const server = new GQLServer()

server.start({
  resolvers: [AuthorResolver, BookResolver],
  federated: !process.env.WITHOUT_FEDERATION,
  requireSignedQueries: true,
  signedQueriesWhitelist: new Set<string>(process.env.QUERY_DIGEST_WHITELIST?.split(','))
}).catch(console.error)
