import crypto from 'node:crypto'
import { GraphQLError, type ASTVisitor, type FieldNode, type ValidationContext } from 'graphql'

export function shasum (str: string) {
  return crypto.createHash('sha256').update(str).digest('hex')
}

/**
 * Walks an object/array and truncates any string longer than `maxLength` to the
 * last full word within that limit, suffixed with an ellipsis. Useful for logging
 * mutation variables without storing entire large payloads (file contents, page
 * bodies, etc.).
 */
export function truncateLongStrings<T> (value: T, maxLength = 50): T {
  if (typeof value === 'string') {
    if (value.length <= maxLength) return value
    const cut = value.slice(0, maxLength)
    const lastSpace = cut.lastIndexOf(' ')
    return ((lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…') as T
  }
  if (Array.isArray(value)) return value.map((v: unknown) => truncateLongStrings(v, maxLength)) as T
  if (value != null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, truncateLongStrings(v, maxLength)])) as T
  }
  return value
}

const disallowed: Record<string, boolean> = { __schema: true, __type: true }
export function NoIntrospection (context: ValidationContext): ASTVisitor {
  return {
    Field (node: FieldNode) {
      if (disallowed[node.name.value]) {
        context.reportError(
          new GraphQLError('GraphQL introspection is not allowed.', { nodes: [node] })
        )
      }
    }
  }
}
