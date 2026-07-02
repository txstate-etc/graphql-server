import fastifyMultipart from '@fastify/multipart'
import { GQLServer } from '../src/index.ts'
import { authenticate } from '../testservicecommon/authenticate.ts'
import { AuthorResolver } from './author/author.resolver.ts'
import { BookPageInformationResolver, BookResolver } from './book/book.resolver.ts'

(async () => {
  const server = new GQLServer({ authenticate })
  await server.app.register(fastifyMultipart)
  await server.start({
    // BookPageInformationResolver targets PageInformation, so GQLServer auto-registers the `pageInfo` query.
    resolvers: [AuthorResolver, BookResolver, BookPageInformationResolver],
    federated: !process.env.WITHOUT_FEDERATION
  })
})().catch(console.error)
