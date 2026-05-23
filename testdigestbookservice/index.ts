import { GQLServer } from '../src/index.ts'
import { authenticate } from '../testservicecommon/authenticate.ts'
import { AuthorResolver } from './author/author.resolver.ts'
import { BookResolver } from './book/book.resolver.ts'

const server = new GQLServer({ authenticate })

server.start({
  resolvers: [AuthorResolver, BookResolver],
  federated: !process.env.WITHOUT_FEDERATION,
  requireSignedQueries: true,
  signedQueriesWhitelist: new Set<string>(process.env.QUERY_DIGEST_WHITELIST?.split(','))
}).catch(console.error)
