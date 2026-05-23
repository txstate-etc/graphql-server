import { GQLServer } from '../src/index.ts'
import { authenticate } from '../testservicecommon/authenticate.ts'
import { BookResolver } from './book/book.resolver.ts'
import { LibraryResolver } from './library/library.resolver.ts'

const server = new GQLServer({ authenticate })

server.start({
  resolvers: [LibraryResolver, BookResolver],
  federated: true
}).catch(console.error)
