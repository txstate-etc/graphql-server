import fastifyMultipart from '@fastify/multipart'
import { GQLServer } from '../src/index.ts'
import { authenticate } from '../testservicecommon/authenticate.ts'
import { AuthorResolver } from './author/author.resolver.ts'
import { BookResolver } from './book/book.resolver.ts'

(async () => {
  const server = new GQLServer({ authenticate })
  await server.app.register(fastifyMultipart)
  await server.start({
    resolvers: [AuthorResolver, BookResolver],
    federated: !process.env.WITHOUT_FEDERATION
  })
})().catch(console.error)
