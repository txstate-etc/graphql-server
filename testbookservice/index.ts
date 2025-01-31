import fastifyMultipart from '@fastify/multipart'
import { GQLServer } from '../src'
import { AuthorResolver } from './author/author.resolver'
import { BookResolver } from './book/book.resolver'

(async () => {
  const server = new GQLServer()
  await server.app.register(fastifyMultipart)
  await server.start({
    resolvers: [AuthorResolver, BookResolver],
    federated: !process.env.WITHOUT_FEDERATION
  })
})().catch(console.error)
