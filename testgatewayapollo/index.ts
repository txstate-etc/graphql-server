import { ApolloServer } from 'apollo-server'
import { ApolloGateway } from '@apollo/gateway'
import { sleep } from 'txstate-utils'

async function main () {
  await sleep(1500)

  // Initialize an ApolloGateway instance and pass it an array of
  // your subgraph names and URLs
  const gateway = new ApolloGateway({
    serviceList: [
      {
        name: 'bookservice',
        url: 'http://bookservice/graphql'
      },
      {
        name: 'libraryservice',
        url: 'http://libraryservice/graphql'
      }
    ]
  })

  // Pass the ApolloGateway to the ApolloServer constructor
  const server = new ApolloServer({
    gateway
  })
  await server.listen({ port: 80 })
}

main().catch(e => { console.error(e); process.exit(1) })
