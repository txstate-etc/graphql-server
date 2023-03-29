import Server from 'fastify-txstate'
import mercurius from 'mercurius'
import { sleep } from 'txstate-utils'

const server = new Server()

async function main () {
  await sleep(2000)
  await server.app.register(mercurius, {
    graphiql: true,
    gateway: {
      services: [
        {
          name: 'bookservice',
          url: 'http://bookservice/graphql'
        },
        {
          name: 'libraryservice',
          url: 'http://libraryservice/graphql'
        }
      ]
    }
  })
  await server.start()
}

main().catch(e => { console.error(e); process.exit(1) })
