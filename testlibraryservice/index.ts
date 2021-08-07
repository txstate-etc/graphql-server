import { GQLServer } from '../src'
import { BookResolver } from './book/book.resolver'
import { LibraryResolver } from './library/library.resolver'

const server = new GQLServer()

server.start({
  resolvers: [LibraryResolver, BookResolver],
  federated: true
}).catch(console.error)
