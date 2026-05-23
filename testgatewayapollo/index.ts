import { ApolloServer } from 'apollo-server'
import { ApolloGateway, IntrospectAndCompose } from '@apollo/gateway'
import { sleep } from 'txstate-utils'

async function main () {
  await sleep(1500)

  const gateway = new ApolloGateway({
    supergraphSdl: new IntrospectAndCompose({
      subgraphs: [
        { name: 'bookservice', url: 'http://bookservice/graphql' },
        { name: 'libraryservice', url: 'http://libraryservice/graphql' }
      ]
    })
  })

  // Pass the ApolloGateway to the ApolloServer constructor
  const server = new ApolloServer({
    gateway
  })
  await server.listen({ port: 80 })
}

main().catch((e: unknown) => { console.error(e); process.exit(1) })
