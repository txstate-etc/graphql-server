# graphql-server
A simple graphql server designed to work with typegraphql.

## Usage
```typescript
import { Server } from '@txstate-mws/graphql-server'
import { MyModel1Resolver } from './mymodel1'
import { MyModel2Resolver } from './mymodel2'
const server = new Server({ ... fastify configuration })
server.start({
  resolvers: [MyModel1Resolver, MyModel2Resolver],
  gqlEndpoint: '/graphql',
  playgroundEndpoint: '/'
}).catch(e => {
  console.error(e)
  process.exit(1)
})
```
