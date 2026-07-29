import { Kind, type DirectiveNode, type GraphQLResolveInfo, type SelectionSetNode } from 'graphql'
import { createParameterDecorator } from 'type-graphql'

/**
 * Evaluate any `@skip`/`@include` directives on a selection against the request's variables.
 * A condition we cannot resolve (malformed document, missing variable) counts the selection as
 * requested — over-fetching is the safe direction for everything in this file, since these
 * helpers exist to decide whether a fetch can be skipped.
 */
function directivesInclude (directives: readonly DirectiveNode[] | undefined, variables: Record<string, unknown>) {
  for (const directive of directives ?? []) {
    const name = directive.name.value
    if (name !== 'skip' && name !== 'include') continue
    const ifValue = directive.arguments?.find(arg => arg.name.value === 'if')?.value
    let condition: boolean | undefined
    if (ifValue?.kind === Kind.BOOLEAN) condition = ifValue.value
    else if (ifValue?.kind === Kind.VARIABLE) {
      const variableValue = variables[ifValue.name.value]
      if (typeof variableValue === 'boolean') condition = variableValue
    }
    if (name === 'skip' ? condition === true : condition === false) return false
  }
  return true
}

function addSelections (selectionSet: SelectionSetNode, info: GraphQLResolveInfo, fields: Set<string>, visitedFragments: Set<string>) {
  for (const selection of selectionSet.selections) {
    if (!directivesInclude(selection.directives, info.variableValues)) continue
    if (selection.kind === Kind.FIELD) fields.add(selection.name.value)
    else if (selection.kind === Kind.INLINE_FRAGMENT) addSelections(selection.selectionSet, info, fields, visitedFragments)
    else if (!visitedFragments.has(selection.name.value)) {
      visitedFragments.add(selection.name.value)
      // validation runs before execution, so the fragment definition is guaranteed to exist
      addSelections(info.fragments[selection.name.value].selectionSet, info, fields, visitedFragments)
    }
  }
}

/**
 * The set of field names the client selected on the current resolver's return type, one level
 * deep. Named and inline fragments are flattened in (regardless of their type conditions, since
 * an abstract-typed result might match any of them), `@skip`/`@include` directives are honored,
 * and aliases resolve to the real field name — `{ author { writerId: id } }` reports `id`,
 * because that's the data you'd need to provide. `__typename` is excluded; graphql answers it
 * without any data from you.
 *
 * Requires the resolver's `GraphQLResolveInfo`, which typegraphql provides via an `@Info()`
 * parameter. If you just want to skip a fetch when the client only asked for ids, use the
 * `@IdOnly()` parameter decorator instead and never touch `info` at all.
 */
export function requestedFields (info: GraphQLResolveInfo) {
  const fields = new Set<string>()
  const visitedFragments = new Set<string>()
  for (const node of info.fieldNodes) {
    if (node.selectionSet != null) addSelections(node.selectionSet, info, fields, visitedFragments)
  }
  fields.delete('__typename')
  return fields
}

/**
 * True when every field the client selected on the current resolver's return type is in the
 * given list — in other words, when data you already have in hand would fully satisfy the
 * selection and the fetch for the rest of the object can be skipped. See `requestedFields` for
 * exactly what counts as selected.
 *
 * This is a one-level check on field names; it doesn't look at sub-selections. Pass leaf fields
 * whose values you actually hold.
 */
export function onlyRequested (info: GraphQLResolveInfo, ...fields: string[]) {
  for (const field of requestedFields(info)) {
    if (!fields.includes(field)) return false
  }
  return true
}

/**
 * Parameter decorator that injects `true` when everything the client selected on this resolver's
 * return type is among the given fields. It adds nothing to your schema — the value is computed
 * from the query document, not sent by the client. See `@IdOnly()` for the motivating case and a
 * full example; use this form when your row carries more than just the id:
 *
 * ```typescript
 * async author (@Ctx() ctx: Context, @Root() book: Book, @OnlyRequested('id', 'name') haveIt: boolean) {
 *   if (haveIt) return { id: book.authorId, name: book.authorName } as Author
 *   return await ctx.svc(AuthorService).findById(book.authorId)
 * }
 * ```
 */
export function OnlyRequested (...fields: string[]) {
  return createParameterDecorator(({ info }) => onlyRequested(info, ...fields))
}

/**
 * Parameter decorator for the classic wasted fetch: the client runs
 * `{ books { author { id } } }`, and your `author` field resolver loads the whole author record
 * to serve up an id that was sitting on the book row the entire time. Declare an `@IdOnly()`
 * parameter and it comes in `true` whenever the selection needs nothing beyond `id`
 * (`__typename` doesn't count against you), so you can return a stub and skip the fetch:
 *
 * ```typescript
 * @FieldResolver(returns => Author)
 * async author (@Ctx() ctx: Context, @Root() book: Book, @IdOnly() idOnly: boolean) {
 *   if (idOnly) return { id: book.authorId } as Author
 *   return await ctx.svc(AuthorService).findById(book.authorId)
 * }
 * ```
 *
 * Two cautions. If the resolver takes arguments that can change the result — a filter that might
 * exclude the author, say — the stub bypasses them, so check those yourself
 * (`if (idOnly && filter == null)`). And the stub skips whatever authorization your service
 * applies to fetched objects; that's fine for an id the parent object already exposes, but think
 * it through before stubbing anything more sensitive with `@OnlyRequested()`.
 */
export function IdOnly () {
  return OnlyRequested('id')
}
