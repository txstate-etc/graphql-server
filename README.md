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

## GraphQL Configuration
* `port?: number` (default 80 or 443 if cert present) - port for your HTTP(S) server to listen to
* `gqlEndpoint?: string|string[]` (default `/graphql`) - endpoint for graphql queries
  `playgroundEndpoint?: string|false` (default `/`) - endpoint to access the GraphQL playground to explore the spec and run handwritten queries. `false` to disable.
* `voyagerEndpoint?: string|false` (default `/voyager`) - endpoint to access GraphQL Voyager for visualizing your spec. `false` to disable.
* `customContext?: Type<CustomContext>` (default `Context`) - provide a custom context class for more request-scoped state or different authentication code (more info later).
* `send401?: boolean` (default `false`) - Return an HTTP 401 response if request is unauthenticated. Only set `true` if none of your API is public. The alternative is to send back empty results or graphql errors when users request private data and haven't authenticated.

## Fastify and GraphQL server
We export a `Server` class; the constructor accepts all the same configuration that you can send to fastify. Once constructed, `server.app` refers to your fastify instance in case you want to add routes, plugins, or middleware. `server.start(config)` will add the GraphQL and playground routes and start the server.

The GraphQL route is extremely lightweight but fast - it caches the parsing and analysis of queries (similar to graphql-jit) to save work on subsequent requests, and supports the apollo-server spec for persisted queries.

## Services
Keeping your project organized is important, and one key way to do that is to split responsibilities into resolvers that are as thin as possible while fully specifying your GraphQL schema, and services that implement your business logic, authorization, caching, dataloading, and database interactions.

The overall strategy adopted by this library is that the GraphQL context is the primary store of information related to a specific request. The dataloader-factory instance is stored there, along with instances of your services, which are created on demand with `context.svc(ServiceClass)` and given the dataloader-factory instance for convenient access.

This library provides a `BaseService` abstract class to help you get started making services. The most important thing it provides is access to the GraphQL context object, with its `ctx` property. So when you write your service methods, you have easy access to the context without having to constantly pass it from your resolvers.

For convenience, `BaseService` passes most methods through from your context, to save you a little bit of typing:

`this.svc` for access to other models' services, a tiny bit faster than `this.ctx.svc`
`this.loaders` for your dataloader-factory instance, a tiny bit faster than `this.ctx.loaders`
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
// returns true if the authenticated user should be able to see the passed user
async mayView (user: User) {
  // find all the courses the passed user is enrolled in
  const registrations = await this.svc(RegistrationService).findByUserId(user.id)
  const sectionService = this.svc(SectionService)
  const sections = await Promise.all(registrations.map(r => sectionService.findById(r.sectionId)))
  // return true if the authenticated user is the instructor in any course the passed user
  // enrolled in
  return sections.some(s => s.instructorId === this.auth.userid)
}
```

## Authentication
By default the library assumes it will get a JWT as a bearer token, and it places the entire payload in ctx.auth. If authentication is not included in the request or fails to validate, ctx.auth will be undefined.

The JWT secret can be provided in the `JWT_SECRET` environment variable. If you are using asymmetric signatures, you can put the public key in `JWT_SECRET_VERIFY` and the private key in `JWT_SECRET` (this library does not make use of the private key).

If you need to support cookies or tokens in the query string or any other sort of scheme, you can subclass the provided `Context` class, override `tokenFromReq` (to retrieve the JWT) or `authFromReq` (to do all the extraction and validation yourself), and pass your subclass in as a configuration option:
```typescript
import { Server, Context } from '@txstate-mws/graphql-server'
class CookieContext extends Context {
  tokenFromReq: req => req.cookies.token
}
const server = new Server({ ... fastify configuration })
server.start({
  ...,
  customContext: CookieContext
})
```
`authFromReq`, if you write it, should return an object for `ctx.auth` or `undefined` if authentication could not be established. It can be async or return a promise if you need to do a lookup, like searching a database for a session id.

## Authorization
Generally speaking, there are two kinds of authorization:
* User-based
  * Access to data and mutations based on who the authenticated user is and their role in the application.
  * Will depend on complicated business logic (see the `mayView` example above where access to a person is authorized based on them being registered for a course you teach.)
* Application-based
  * Access to data and mutations based on the application for which the access token was generated.
  * Usually simply limits the types of data allowed, like saying that a course catalog application can only see semesters and course details, but no user information.
  * Can be implemented with a TypeGraphQL middleware. This library doesn't provide anything extra.

This library provides a completely opt-in `AuthorizedService` abstract class that you can use instead of `BaseService`. Each `AuthorizedService` must provide a `mayView` method that accepts an instance of the model associated with the service. This will be where we implement user-based authorization for each data type.

`AuthorizedService` also provides a `removeUnauthorized` method for convenience, which calls `mayView` on each array element and filters out objects the authenticated user should not see. It should be used every time a service method returns an array.

There's nothing here for authorizing mutations; that should generally take place at the beginning of the mutation method in the service class, but can also be broken out into helper methods like `mayCreate` or `mayDelete`.

## Timing
Earlier I mentioned `ctx.timing(...messages: string[])`. This is just a quick convenience method to help you track the passage of time for an individual request. You can use it to replace `console.log` statments, and each time it will print the amount of time elapsed since the last statement. Makes it easier to investigate where your bottlenecks are.

## Validation Errors
Error handling in GraphQL can get a little complicated since there are so many different ways to return errors. You can return an HTTP status code, but it's not very GraphQL-like because GraphQL is supposed to be transport-agnostic. So usually you return an `errors` array with a 200 response, and each error can have an extensions property with all kinds of extra metadata. That's also not very GraphQL-like because the extensions property doesn't have a self-documented spec with shape and types.

What this library encourages is to split your errors into unexpected system errors and expected validation errors. Unexpected errors happen when the infrastructure is offline or a developer has made a mistake (either an API developer or a UI developer). Those errors get thrown and end up in the `errors` array.

Expected errors happen when a user makes a mistake, like specifying a date outside the allowed range. These errors should not be in the `errors` array at all. Instead, we should allow for the possibility of an error in the response.

This library provides a `ValidatedResponse` type for this purpose. A `ValidatedResponse` has a `success` property to indicate whether the mutation took place or was rejected without altering any state. It also has a `messages` property with messages to be presented to the user. Each message has a type: `error`, `warning`, or `success`, and an `arg` identifying the mutation argument that caused the message. `arg` may be dot-separated or in bracket notation when one of the arguments is an object and the error is deep inside it.

Note that there can be messages even when `success` is `true`. Messages with type `success` are to let the user know that they did something well; for example, the password they've entered is strong. Messages with type `warning` warn the user about something, but allow the mutation to complete anyway.

The `arg` should always identify the GraphQL argument that caused the error. For instance, `createUser(username: 'Hamburger')` might reply with a message that looks like `{ message: 'That is not a name for humans!', type: 'error', arg: 'username' }`.

To use a `ValidatedResponse`, simply create and return one during the course of servicing a mutation. Note that you often want to collect validation errors instead of returning immediately, so that you can communicate to users about all the things that went wrong all at once instead of hitting them with a new one each time they resolve something. You can use the `hasErrors` method to determine whether one or more errors occurred.
```typescript
class UserService extends BaseService {
  async registerForClass (section: Section) {
    if (!await userAllowedToRegister(ctx.auth.username, section)) {
      return ValidatedResponse.error('This user cannot register for this course.')
    }
    const response = new ValidatedResponse()
    if (!await sectionHasAvailability(section)) {
      response.addMessage('This course is full.', 'section', 'error')
    }
    if (!await sectionHasAnInstructor(section)) {
      response.addMessage('This course has no instructor yet.', 'section', 'error')
    }

    if (!response.hasErrors()) {
      await registerUserForSection(ctx.auth.username, section)
      response.success = true
    }
    return response
  }
}
```
`ValidatedResponse` also has several convenience methods to help you quickly make assertions, and any that fail will set `success` to `false` and add an appropriate message against the correct `arg`.
```typescript
  async createObject(args: CreateObjectArguments) {
    const response = new ValidatedResponse()
    response.assertLength(args, 'friend.username', 8, 12)
    if (!response.hasErrors()) {
      await addObjectToDatabase(args)
      response.success = true
    }
    return response
  }
```
