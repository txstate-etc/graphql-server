# graphql-server
A simple graphql server designed to work with typegraphql.

## Overview
This library provides a very simple setup combining typegraphql, fastify,
dataloader-factory, and some custom code to help organize services to feed your
resolvers.

## Basic Usage
```typescript
import { GQLServer } from '@txstate-mws/graphql-server'
import { MyModel1Resolver } from './mymodel1'
import { MyModel2Resolver } from './mymodel2'
const server = new GQLServer({ ... fastify configuration })
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
* `federated?: boolean` (default: `false`) - API is meant to be a member of a federated system. See "Federation" below for more info.
* `after?: (queryTime: number, operationName: string, query: string, variables: any) => Promise<void>` - A function to run after a successful query. Useful for logging query execution time for later analysis. `queryTime` is the number of milliseconds for which the query was executing. Does not fire for introspection queries.
* `requireSignedQueries?: boolean` (default: `false`) - If set then requests are expected to include a signed digest of the `client_id` service and query string.
* `signedQueriesWhitelist?: Set<string>` (default: empty set) - This is a set of whitelisted client services that are not required to provide query digests in requests.

## Fastify and GraphQL server
We export a `GQLServer` class; the constructor accepts all the same configuration that you can send to fastify. Once constructed, `server.app` refers to your fastify instance in case you want to add routes, plugins, or middleware. `server.start(config)` will add the GraphQL and playground routes and start the server.

The GraphQL route is extremely lightweight but fast - it caches the parsing and analysis of queries (similar to graphql-jit) to save work on subsequent requests, and supports the apollo-server spec for persisted queries.

## Context
The overall strategy adopted by this library is that the GraphQL context is not just for authentication information; it is where we will store all state related to fulfilling a specific request, including request-scoped caching. To do this, we provide a `Context` class that is coded up and ready to support this strategy. The `dataloader-factory` instance is stored there as `ctx.loaders`, along with authentication information as `context.auth`, and instances of your services, which are created on demand with `context.svc(ServiceClass)`.

This way, fetching a service instance inside a resolver is very straightforward:
```typescript
@Query(returns => [Book])
async books (@Ctx() ctx: Context) {
  return await ctx.svc(BookService).fetchAll()
}
```

## Services
We mentioned services in the previous section, but we haven't talked about what those are yet. Keeping your project organized is important, and one key way to do that is to split responsibilities. First you have `typegraphql` resolvers that are as thin as possible while fully specifying your GraphQL schema. The resolvers make calls to service classes that implement your business logic, authorization, caching, dataloading, and database interactions. I usually like to split things a little further so that database-specific SQL is in yet another layer, but we won't cover that in this README as it's not necessary for `graphql-server`.

To help you organize services this way, this library provides a `BaseService` abstract class. The most important thing it provides is the `Context` object we discussed earlier. Anything extending `BaseService` will have a `this.ctx` property for easy access to the context without having to constantly pass it from your resolvers.

```typescript
const bookLoader = new PrimaryKeyLoader({
  fetch: (ids: string[]) => await getBooks(ids)
})

class BookService extends BaseService {
  async findById (id: string) {
    return await this.loaders.get(bookLoader).load(id)
  }
}
```

You might notice above that I used `this.loaders` instead of `this.ctx.loaders`, totally contradicting what I stated above. Well, for convenience, `BaseService` passes applicable methods through to its context, to save you a little bit of typing:

* `this.svc` for access to other models' services, a tiny bit easier than `this.ctx.svc`
* `this.loaders` for your dataloader-factory instance, a tiny bit easier than `this.ctx.loaders`
* `this.auth` for the user object provided by authentication, over `this.ctx.auth`
* `this.timing` for development logging, over `this.ctx.timing`
* `this.requireAuth` to interrupt execution and signal the UI that the user needs to log in

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

The JWT base64 encoded secret can be provided in the `JWT_SECRET` environment variable. If you are using asymmetric signatures, you can put the public key in `JWT_SECRET_VERIFY` (this library does not make use of the private key). If both environment variables are set the asymmetric `JWT_SECRET_VERIFY` key is used.
```bash
# Examples of how to create keys for context jwt tokens
# Symetric key
JWT_SECRET=$(cat /dev/urandom | head -c32 | base64 -)
# Private and public keys
JWT_SECRET_SIGN=$(openssl genrsa 2048 2>/dev/null)
JWT_SECRET_VERIFY=$(echo "$JWT_SECRET_SIGN" | openssl rsa -outform PEM -pubout 2>/dev/null)
```

## Query Scoping
Sometimes we want to verify that a client service has authorization to process a query. By setting the graphql-server configuration `requireSignedQueries` option to true, queries received by the server will require an associated query digest that scopes the query requested to the client service.

Query digests are a sha256 hash of the client service name/id and a query string. This digest is then bundled as the `qd` field in the JWT payload, which is signed by a private key for approved queries. The private query digest key is never shared or accessed by the client service. The private key is only used to sign approved queries. The JWT that is generated may then be checked into the repo. When the client service needs to make a request to the graphql service it will send the associated query digest JWT in the `x-query-digest` http header along with it's `client_id` service name JWT in the authentication header and query string in the body.

When the graphql-server sees a request with query scoping turned on, it will first verify the JWT authn token and pull the client service name found in the `client_id` field of the authentication payload. The client service name is then hashed with the query sent in the body of the request to generate a query digest. It is then matched to the `qd` hash found in the signed query digest token that was also sent by the client service in the `x-query-digest` header. If it is a match the query is indeed allowed by this client service and may be processed.
```bash
# Examples of how to create keys used for query digest jwt tokens
JWT_QUERY_DIGEST_PRIVATE_KEY=$(openssl genrsa 2048 2>/dev/null)
JWT_QUERY_DIGEST_PUBLIC_KEY=$(echo "$JWT_QUERY_DIGEST_PRIVATE_KEY" | openssl rsa -outform PEM -pubout 2>/dev/null)
```

Query scoping allows for some clients to be whitelisted and not require query digest with their requests. Use the graphql-server `signedQueriesWhitelist: Set<string>` option to contain a collection of the client service names excluded from Query scoping.

If you need to support cookies or tokens in the query string or any other sort of scheme, you can subclass the provided `Context` class, override `tokenFromReq` (to retrieve the JWT) or `authFromReq` (to do all the extraction and validation yourself), and pass your subclass in as a configuration option:
```typescript
import { GQLServer, Context } from '@txstate-mws/graphql-server'
class CookieContext extends Context {
  tokenFromReq: req => req.cookies.token
}
const server = new GQLServer({ ... fastify configuration })
server.start({
  ...,
  customContext: CookieContext
})
```
`authFromReq`, if you write it, should return an object for `ctx.auth` or `undefined` if authentication could not be established (do NOT return an object with an empty user id!). It can be async or return a promise if you need to do a lookup, like searching a database for a session id.

Keep in mind that if you add brand new methods to your custom Context class, you'll need to reference your class in every resolver after `@Ctx()`:
```typescript
@FieldResolver(returns => [Author])
async authors (@Ctx() ctx: CustomContext, @Root() book: Book) {
  // return the authors
}
```
If all you've done is replace `authFromReq` or `tokenFromReq`, this isn't necessary because all the types are compatible and the context object you'll receive will still be an instance of whatever you passed as `customContext`.
### Enforcing/detecting authentication
As documented above, the `send401` option can be set to make sure your entire API require authentication. If your API is partially public, you'll want to keep this false. Then you can simply call `ctx.requireAuth()` in any resolver that requires authentication or `this.requireAuth()` in any service method.

Your clients will be able to detect an authentication problem by checking whether `errors[0].authenticationError` in the response data is `true`. They may need to redirect their user to a login screen.

## Authorization
Generally speaking, there are two kinds of authorization:
* User-based
  * Access to data and mutations based on who the authenticated user is and their role in the application.
  * Will depend on complicated business logic (see the `mayView` example above where access to a person is authorized based on them being registered for a course you teach.)
* Application-based
  * Access to data and mutations based on the application for which the access token was generated.
  * Usually simply limits the types of data allowed, like saying that a course catalog application can only see semesters and course details, but no user information.
  * Can be implemented with a TypeGraphQL middleware. This library doesn't provide anything extra.

This library provides a completely opt-in `AuthorizedService` abstract class that you can use instead of `BaseService`.

Each `AuthorizedService` may provide a `mayView` method that accepts an instance of the model associated with the service and returns true only if the current authenticated user should be able to view the object. This is how we implement complex user-based authorization for each data type.

Additionally, each service may provide a non-mutating `removeProperties` method that accepts an instance of the model and removes or anonymizes one or more properties from the object before returning it. Do NOT mutate the input object, it will be in the dataloader cache and shouldn't be altered. Return a cloned object instead.

Finally, `AuthorizedService` provides a `removeUnauthorized` method that your service may use to clean out objects the user shouldn't see. It calls `mayView` and `removeProperties` on each array element and filters out objects and properties the authenticated user should not see. It should be used every time a service method returns an array.

There's nothing here for authorizing mutations; that should generally take place at the beginning of the mutation method in the service class, but can also be broken out into helper methods like `mayCreate` or `mayDelete`.

### Typescript Note
If you'd like to keep track of the data type of `ctx.auth`, you can pass it as a generic, or create your own `AuthorizedService`:
```typescript
export abstract class AuthzdService extends AuthorizedService<{ username: string }> {}

export class BookService extends AuthzdService {
  async mayCreate () {
    return await isUserAnAdmin(this.auth.username) // this.auth.username is typed as a string
  }
}
```
This is also a great way to add more authorization-related helper methods like `fetchCurrentUser` or `isLibraryOwner` for use in multiple services.
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
    if (!await userAllowedToRegister(this.auth.username, section)) {
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
### Extending ValidatedResponse
GraphQL mutations are encouraged to return an object, usually the object which was just mutated. To do
this, you would need to extend the `ValidatedResponse` to add your return object.
```typescript
@ObjectType()
export class BookValidatedResponse {
  @Field(type => Book)
  book: Book

  constructor (args: ValidatedResponseArgs & { book: Book }) {
    super(args)
    this.book = args.book
  }
}
```
### Convienence Assertions
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
The convenience methods are:
* `response.assert (condition: boolean, message: string, arg?: string)`
* `response.assertBetween (input: any, arg: string, min: number, max: number)`
  * error message will be `Value out of range, must be between ${min} and ${max}`
* `assertPositive (input: any, arg: string)`
  * error message will be `Value must not be negative`
* `assertLength (input: any, arg: string, min: number, max: number)`
  * error message for strings `Character maximum exceeded.` or `Character minimum not met.`
  * error message for arrays `Too many entries.` or `Not enough entries.`

## Logging
Logging is pre-configured for you using `fastify` and `pino`. Log entries are in JSON format. The request complete log entry includes GraphQL-specific properties recording the query, operation name, and the contents of `ctx.auth`.

When `NODE_ENV` is set to `development`, the request log is mostly disabled, only printing the response time and query for each. Errors will be logged directly to the console instead of in JSON format, for much better readability with proper line breaks.

## Federation
If your GraphQL API is intended to be a member of a federation gateway, graphql-server provides some
extra support for you. When you set the option `federated: true`, it will automatically add the federation directives and the `_service` and `_entities` resolvers based on your usage of the directives (more on that below).

It's up to you to use the directives appropriately. Following are some of the things you'll want to do.

### Namespacing
When federating graphs, renaming types is hard (this library provides no tools for doing it, but some do exist). It's important to avoid name collisions when the types do not describe the same concept.

For instance, a user is a concept shared by most applications, so calling it `User` everywhere is probably ok. However, something named `Rule` is highly likely to exist in multiple systems and mean something totally different in each one. Try to prefix generic type names with the name of the application so that you won't have to jump through hoops to transform your API for federation.

### Expose a type for other graphs to stub or extend
In a federated GraphQL environment, new graphs will come online regularly and need to extend types that already exist in the graph. Unfortunately, the graph that owns the type must support extension by providing the `@key` directive identifying the primary key for the type. On the bright side, adding this support is not a breaking API change.

To provide support, first add `@Directive('@key(fields: "id")')` as a decorator of your model class, where `"id"` is a space-separated list of fields involved in the primary key.

Then you'll need to provide a reference resolver function. The gateway is going to send a "stub" object (an object containing all the fields from at least one of the `@key` directives you specified) as the parent, and you need to transform that stub object into the regular object.

To support this, `graphql-server` provides a `@ResolveReference('TypeName')` decorator that you can use to decorate your resolver function.  Your resolver function is NOT a regular resolver. Do NOT decorate it with `@FieldResolver` or use the argument decorators like `@Ctx()` or `@Root()`. Just use the standard graphql resolver signature `async function (root: YourTypeStub, args: any, ctx: Context, info: GraphQLResolveInfo) => YourType`.

It's probably most convenient to place it with your field resolvers (just remember it's not one).
```typescript
@Resolver(for => Book)
export class BookResolver {
  @Query ...
  ... query resolver ...

  @ResolveReference('Book')
  async resolveReference (stub: { id: number }, _args: any, ctx: Context) {
    return await ctx.svc(BookService).findById(stub.id)
  }
}
```
Entity resolution queries will arrive from the gateway in large batches and your resolveReference functions will all be run concurrently. Use dataloader as normal to maintain good performance.

Note: for now `ResolveReference` requires you to hand it the type name. Maybe in the future it'll be able to figure it out automatically.

#### Advanced Primary Keys
It's also possible to support multiple primary keys and nested primary keys. See https://www.apollographql.com/docs/federation/entities/ for more detail. Keep in mind that your resolveReference resolver must detect which kind of stub has been provided and perform its lookup appropriately.

### Resolve a type in another graph
When you need to connect to another graph, you'll usually want to add your relationship in both directions from the same API. The connection from your graph to the other graph is accomplished by creating a stub type.

Consider the sample API from this library's automated tests. There is a book service that knows about books and their authors, and a library service that allows users to place books from the book service into their personal library.

The Library type needs a `books` property that returns books from the book service. We do this by creating an array of "stub" books in our graph that act as stand-ins for the full book objects. The federation gateway will be responsible for fetching the full objects.

First, create a type for the stub:
```typescript
@Directive('@extends')
@ObjectType()
export class Book {
  @Directive('@external')
  @Field(type => Int)
  id!: number
}
```
The `@extends` directive lets the gateway know that we don't own this type and we need its help to fetch it. You must add the `@extends` directive even if you are not adding any new properties to the type (see below for more on that).

The `@external` directive lets the gateway know which fields belong to another graph. All the fields involved in another graph's `@key` directive should be listed on your stub and marked external. If you have any fields not marked external, the gateway will add them to the federated graph and assume that you are responsible for filling them with data (see below section for more).

Then create a resolver that creates stubs:
```typescript
@Resolver(of => Library)
export class LibraryResolver {
  ... other resolvers ...

  @FieldResolver(returns => [Book])
  async books (@Ctx() ctx: Context, @Root() library: Library) {
    const bookIds = await ctx.svc(LibraryService).getBookIdsForLibrary(library)
    return bookIds.map(id => ({ id }))
  }
}
```
Since we returned an object compatible with our Book stub above, the federation gateway will be able to fill out the stub with the rest of the book details and connect us with all the other Book field resolvers in other services.

### Extend a type in another graph
Sometimes you will not only connect to another graph, but add properties to some of its types. In the example from the above section, you might add `libraries` to the `Book` type so that you can look up all the libraries that contain a book.

Since the library service owns all the data that links libraries to books, the library service must implement this resolver, even though the library service does not own the `Book` type.

Since the gateway will need to come to you to get properties filled out, you'll need to add the `@key` directive to your extended stub so that the gateway knows which fields to send to you.
```typescript
@Directive('@extends')
@Directive('@key(fields: "id")')
@ObjectType()
export class Book {
  @Directive('@external')
  @Field(type => Int)
  id!: number
}
```
Then you need to add a resolver for each of the extra properties.

If you have any new scalar properties, you can choose to provide a reference resolver with `@ResolveReference`, as you learned to do above, or you can list all the new properties as field resolvers, and dataload in your table row in each one. That's up to you, but `@ResolveReference` is probably easier in general.

#### Using the @requires directive
If you are adding a property, and you need another property on the same type from another graph, you can use the `@requires` directive to make sure the gateway sends it to you.
```typescript
@Resolver(of => Book)
export class BookResolver {
  @Query ...
  ... query resolver ...

  @Directive('@requires(fields: "isbn")')
  @FieldResolver(returns => Float)
  async amazonPrice (@Ctx() ctx: Context, @Root() bookstub: Book) {
    return await ctx.svc(AmazonService).getBookPriceByISBN(bookstub.isbn!)
  }
}
```
Keep in mind that any field you require must be listed in your stub model as `@external`.
```typescript
@Directive('@extends')
@Directive('@key(fields: "id")')
@ObjectType()
export class Book {
  @Directive('@external')
  @Field(type => Int)
  id!: number

  @Directive('@external')
  @Field()
  isbn?: string
}
```
This is so that the federation gateway can validate that the type of data you require still matches what will be provided in the host service. You may think this check is unnecessary, but Apollo Gateway will fail to validate so you don't have much choice.

Something else in this example was a little tricky. The isbn CANNOT be marked as nullable for graphql, because the original type does not mark isbn as nullable and they must match. However, it needs to be marked optional for typescript so that you can make stubs (since you don't have the isbn when making a stub). When you implement your resolver, you'll have to use an exclamation mark (as in the example above) to assure typescript that the gateway will have provided it.

### Using the @provides directive
TODO

### Federated relationships with filtering
TODO
