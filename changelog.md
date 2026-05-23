# Changelog

## 3.0.0

Major rewrite. ESM-only, fastify 5, type-graphql 2, graphql 16, Apollo Federation v2. All four are breaking, and the auth model is reorganized on top of that. Read the migration sections in order — most apps will need to touch all of them.

---

### Breaking: package is now ESM-only

`package.json` declares `"type": "module"` and ships a single `dist/` build. The `exports` map no longer has a `require` entry. CommonJS consumers cannot `require('@txstate-mws/graphql-server')` anymore.

**Migrate:**
- Set `"type": "module"` in your own `package.json`.
- Use `tsconfig.json` with `"module": "NodeNext"` and `"moduleResolution": "NodeNext"`.
- Node 24+ recommended.

---

### Breaking: authentication is no longer owned by `Context`

Auth handling moved to [fastify-txstate](https://github.com/txstate-etc/fastify-txstate) v4. `Context` no longer fetches tokens, caches keys, or validates JWTs — it just reads the auth info that fastify-txstate has already attached to the request.

**Removed from the public API:**
- `Context.init()` — no longer called or needed.
- `Context.tokenCache`, `authFromReq`, `authFromPayload`, `validateToken`, `processIssuerConfig`.
- The `TxStateUAuthContext` and `FastifyTxStateContext` classes.
- The `JWT_SECRET` env var. The library no longer reads it.

**Deprecated but retained:**
- `Context.waitForAuth()` — auth is synchronous now, so the name is misleading. The hook still runs (the new `prefetch()` default implementation awaits it) so existing subclasses keep working without code changes. Override `prefetch()` instead in new code.

**Added:**
- `Context.prefetch()` — an overridable async hook the server awaits once per request, after `ctx.auth` is populated and before query execution / `send403`. This is the seam for prefetching the authenticated user's roles, permissions, or any other request-scoped state you want loaded synchronously by the time resolvers run. Skipped when `send401` is set and the request is unauthenticated. See the README's "Prefetching per-request state" section.

**Changed:**
- `Context<AuthType>` and `MockContext<AuthType>` now constrain `AuthType extends FastifyTxStateAuthInfo` (was unconstrained).
- `auth.client_id` is now `auth.clientId` (camelCase rename in fastify-txstate 4). The `requireSignedQueries` flow uses `auth.clientId` everywhere.
- `MockContext` constructor signature is `(auth?, req?)`. `Context` constructor is `(req?)` and reads `req.auth` synchronously.
- `BaseService`, `AuthorizedService`, `AuthorizedServiceSync` now constrain their `AuthType` generic to `extends FastifyTxStateAuthInfo` (was `= any`).

**Migrate:**

Before (v2):
```ts
// You subclassed Context and overrode authFromReq (or authFromPayload) to do
// token verification yourself, then passed the subclass as customContext. The
// library called waitForAuth() on every request before resolvers ran, so
// ctx.auth was populated by the time your code read it.
import { GQLServer, Context } from '@txstate-mws/graphql-server'
import { jwtVerify } from 'jose'

class MyContext extends Context {
  async authFromReq (req) {
    const header = req?.headers.authorization
    if (!header?.startsWith('Bearer ')) return undefined
    const token = header.slice(7)
    const { payload } = await jwtVerify(token, secret, { issuer: 'your-issuer' })
    // it was common to return the jwt payload directly, in v3 we will give it a structured type
    return payload
  }
}

const server = new GQLServer()
await server.start({ resolvers: [...], customContext: MyContext })

// In a resolver / service:
if (this.auth?.client_id) { ... }   // snake_case
```

(Alternatively, the library could verify JWTs for you if you set `JWT_SECRET` / `JWT_SECRET_VERIFY` and let the default `Context.authFromPayload` map the payload onto `ctx.auth`. That env-var path is gone in v3.)

After (v3):
```ts
// You provide an authenticate callback. fastify-txstate calls it on every request
// and sets req.auth. The shape it returns becomes ctx.auth (sync).
import { GQLServer } from '@txstate-mws/graphql-server'
import { jwtVerify } from 'jose'

async function authenticate (req) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return undefined
  const token = header.slice(7)
  const { payload } = await jwtVerify(token, secret, { issuer: 'your-issuer' })
  // must return something conforming to FastifyTxStateAuthInfo
  return {
    username: payload.sub,
    sessionId: `${payload.sub}-${payload.iat}`,
    token,
    clientId: payload.client_id  // note: returned field is camelCase
  }
}

const server = new GQLServer({ authenticate })
await server.start({ resolvers: [...] })

// In a resolver / service:
const auth = this.ctx.auth     // sync, no await
if (auth?.clientId) { ... }    // camelCase
```

The token-verification code that used to live in your `Context` subclass (or in the library, when configured via `JWT_SECRET`) now lives in the `authenticate` callback. See the README's "Authentication" section for a complete example.

**Note:** `send401`, `send403`, and `requireSignedQueries` remain `GQLStartOpts` flags and behave the same way. Only the source of `ctx.auth` has changed.

---

### Breaking: Apollo Federation v1 is dropped; v3 is federation v2 only

Federation support targets Apollo Federation **v2.7**. There is no v1 fallback and no `federationVersion` option. Setting `federated: true` now emits a v2 subgraph SDL.

**What changed in the SDL the library emits:**
- The library auto-prepends `extend schema @link(url: "https://specs.apollo.dev/federation/v2.7", import: [...])` to `_service.sdl`. You don't declare `@link` yourself.
- Subgraphs now own their root types: SDL contains `type Query { ... }` instead of `extend type Query { ... }`.
- The `@extends` directive is gone.
- The `_FieldSet` scalar was renamed to `FieldSet` (only observable if you introspect the directive definitions, which routers don't).

**New v2 directives available** (use as `@Directive('@...')` on your type-graphql models):
- `@shareable` — field is legitimately resolvable by more than one subgraph.
- `@inaccessible` — hide a field from the supergraph.
- `@override(from: "subgraph-name")` — take ownership of a field from another subgraph.
- `@tag(name: "...")` — pass-through metadata for downstream tooling (contracts, GraphOS).
- `@composeDirective(name: "...")` — schema-level, for forwarding custom directives.
- `@interfaceObject` — interface federation.
- `@key` is now `repeatable`, so multiple `@key` directives on one type are first-class.
- `@key(fields: "...", resolvable: false)` — declare a stub for a type owned by another subgraph.

**Migrate stub types** (the most common federation v1→v2 fix):

Before (v1):
```ts
@Directive('@extends')
@Directive('@key(fields: "id")')
@ObjectType()
export class Book {
  @Directive('@external')
  @Field(type => Int)
  id!: number

  @Directive('@external')
  @Field()
  title?: string
}
```

After (v2):
```ts
@Directive('@key(fields: "id", resolvable: false)')
@ObjectType()
export class Book {
  @Directive('@external')
  @Field(type => Int)
  id!: number

  @Directive('@external')
  @Field(type => String)
  title?: string
}
```

Drop `@Directive('@extends')` everywhere. If your subgraph contributes new fields to a type owned elsewhere, use `@key(..., resolvable: false)` plus `@external` only on the borrowed key fields. (In v2, `@external` is required on `@requires`/`@provides` source fields — it is no longer needed on every borrowed field.)

**Migrate gateway:** Apollo Gateway 2.9+ composes v2 subgraphs natively; no consumer changes needed there.

---

### Breaking: type-graphql 2 requires explicit field types

The library is built and tested under tsx/esbuild, which **does not** emit `emitDecoratorMetadata` (see [esbuild#257](https://github.com/evanw/esbuild/issues/257)). type-graphql can still infer types when you build with `tsc`, but a bare `@Field()` will throw `NoExplicitTypeError` at runtime under tsx.

**Migrate:** Convert every bare `@Field()` to an explicit form.

```ts
// Before
@Field() title!: string
@Field() count!: number

// After
@Field(type => String) title!: string
@Field(type => Int) count!: number
```

The same applies to `@Arg()` and `@Query()` / `@Mutation()` return types — anywhere type-graphql 2 would have read the TypeScript type from `Reflect.getMetadata`. If your build is purely `tsc`-based you can technically skip this, but doing it everywhere is safer and lets you switch to tsx later.

If you keep `tsc`-based builds, leave `experimentalDecorators: true` and `emitDecoratorMetadata: true` in your `tsconfig.json`. type-graphql 2 still uses legacy decorators.

---

### Breaking: peer dep on `graphql-scalars`

`graphql-scalars` is now a peer dep (required by type-graphql 2). Add it to your own `dependencies`:

```json
{
  "dependencies": {
    "graphql-scalars": "^1.25.0"
  }
}
```

---

### Breaking: bumped peer/runtime deps

If you import from any of these directly, review their changelogs:

| Package | Was | Now |
|---|---|---|
| `fastify` | 4.x | `^5.0.0` |
| `fastify-txstate` | 3.x | `^4.0.0` |
| `@fastify/multipart` | 8.x | `^9.0.0` |
| `graphql` | 15.x | `^16.12.0` |
| `type-graphql` | 1.x | `2.0.0-rc.4` |
| `jose` | 4.x/5.x | `^6.0.0` |
| `lru-cache` | 7.x | `^11.0.0` |
| `txstate-utils` | 1.x | `^1.9.5` |
| `@graphql-tools/utils` | 9.x | `^10.0.0` |
| `dataloader-factory` | 3.x | `^4.1.3` |
| `reflect-metadata` | 0.1.x | `^0.2.1` |

The graphql 16 jump only matters if you call `execute()` directly — its signature changed from positional args to a single `ExecutionArgs` object. The library handles its own internal call.

---

### Other notable changes

- `pino` is now a direct dep (was transitive). The dev logger emits proper pino structured output with `child()` support so it works under fastify 5's `loggerInstance` slot.
- `GQLStartOpts` generic constraint tightened: `<CustomContext extends typeof Context = typeof Context>` (was `typeof MockContext`). If you pass a `customContext`, it must extend `Context`, not `MockContext`.
- `GQLRequest['Body']['variables']` is now typed `Record<string, unknown>` instead of `object`.
- Multipart handling stays the consumer's responsibility — you still register `@fastify/multipart` yourself if you need file uploads.
- New `beforeStartup?: (schema: GraphQLSchema) => Promise<void>` option (added in 2.3.13, carried forward) for running async setup after the schema is built but before the server accepts requests.

---

### Migration checklist

For a typical consumer upgrading from v2:

1. Add `"type": "module"` to your `package.json`. Update `tsconfig.json` to NodeNext ESM.
2. Add `graphql-scalars` to your own `dependencies`.
3. Bump `@txstate-mws/graphql-server` to `^3.0.0` and run `npm install`.
4. Replace `JWT_SECRET` env-var setup with an `authenticate` callback passed to `new GQLServer({ authenticate })`. Verify your JWT inside the callback and return a `FastifyTxStateAuthInfo`-shaped object.
5. Rename every `auth.client_id` reference to `auth.clientId`.
6. Drop every `await` in front of `ctx.auth` / `this.auth`. Auth is synchronous.
6a. If your `Context` subclass used `waitForAuth()` to prefetch roles/permissions, rename it to `prefetch()`. The old name still works (deprecated) but the hook's purpose is no longer "wait for auth" — it's "do async setup once auth is known."
7. If you use federation: remove every `@Directive('@extends')`, replace stub types with `@key(fields: "id", resolvable: false)`, and remove any manual `@link` declarations you may have added.
8. Convert every bare `@Field()` to `@Field(type => Type)`. Same for `@Arg()` where you relied on metadata inference.
9. Build, run your tests, and check `_service { sdl }` if you operate a subgraph — it should start with `extend schema @link(url: "https://specs.apollo.dev/federation/v2.7", ...)`.
