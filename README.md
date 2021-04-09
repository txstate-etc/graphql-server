# graphql-server
A simple graphql server designed to work with typegraphql.

## Overview
This library provides a very simple setup combining typegraphql, fastify,
dataloader-factory, and some custom code to help organize services to feed your
resolvers.

## Basic Usage
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

## Fastify and GraphQL server
We export a `Server` class; the constructor accepts all the same configuration that you can send to fastify. Once constructed, `server.app` refers to your fastify instance in case you want to add routes, plugins, or middleware. `server.start(config_SeeBasicUsage)` will add the GraphQL and playground routes and start the server.

The GraphQL route is extremely lightweight but fast - it caches the parsing and analysis of queries (similar to graphql-jit) to save work on subsequent requests, and supports the apollo-server spec for persisted queries.

## Services
Keeping your project organized is important, and one key way to do that is to split responsibilities into resolvers that are as thin as possible while fully specifying your GraphQL schema, and services that implement your business logic, authorization, caching, dataloading, and database interactions.

The overall strategy adopted by this library is that the GraphQL context is the primary store of information related to fulfilling a request. The dataloader-factory instance is stored there, along with instances of your services, which are created on demand with `context.svc(ServiceClass)` and given the dataloader-factory instance for convenient access.

This library provides a `BaseService` abstract class to help you get started making services. The most important thing it provides is access to the GraphQL context object, with its `ctx` property. So when you write your service methods, you have easy access to the context without having to constantly pass it from your resolvers.

For convenience, `BaseService` passes most methods through from your context, to save you a little bit of typing:

`this.svc` for access to other models' services, a tiny bit faster than `this.ctx.svc`
`this.loader` for your dataloader-factory instance, a tiny bit faster than `this.ctx.loader`
`this.auth` for the user object provided by authentication, over `this.ctx.auth`
`this.timing` for development logging, over `this.ctx.timing`

So when you need access to data, no matter whether you are in a resolver or another model's service, you can obtain the service of your choice from the context.

### Example inside a resolver:
```typescript
@Query(returns => [User])
async users (@Ctx() ctx: Context, @Arg('filter') filter: UserFilters): Promise<User[]> {
  return await ctx.svc(UserService).find(filter)
}
```
### Example getting a different service inside a service
```typescript
async mayView (user: User) {
  const registrations = await this.svc(RegistrationService).findByUserId(user.netid)
  const sectionService = this.svc(SectionService)
  const sections = await Promise.all(registrations.map(r => sectionService.findById(r.sectionId)))
  return sections.some(s => s.instructorId === this.auth.netid)
}
```

## Authentication
Currently the library assumes it will get a JWT as a bearer token containing `username` in the payload. Expect this to get more sophisticated in the future.

## Authorization
Generally speaking, there are two kinds of authorization:
* User-based
  * Access to data and mutations based on who the authenticated user is and their role in the application.
  * Will depend on complicated business logic (see the `mayView` example above where access to a course section is authorized based on being registered for the course.)
* Application-based
  * Access to data and mutations based on the application for which the access token was generated.
  * Usually simply limits the types of data allowed, like saying that a course catalog application can only see semesters and course details, but no user information.
  * Can be implemented with a TypeGraphQL middleware. This library doesn't provide anything extra.

This library provides a completely opt-in `AuthorizedService` abstract class that you can use instead of `BaseService`. Each `AuthorizedService` must provide a `mayView` method that accepts an instance of the model associated with the service. This will be where we implement user-based authorization for each data type.

`AuthorizedService` also provides a `removeUnauthorized` method for convenience, which calls `mayView` on each array element and filters out objects the authenticated user should not see. It should be used every time a service method returns an array.

## Timing
Earlier I mentioned `ctx.timing(...messages: string[])`. This is just a quick convenience method to help you track the passage of time for an individual request. You can use it to replace `console.log` statments, and each time it will print the amount of time elapsed since the last statement. Makes it easier to investigate where your bottlenecks are.
