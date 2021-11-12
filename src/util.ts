import crypto from 'crypto'
import { GraphQLError } from 'graphql'

export function shasum (str: string) {
  return crypto.createHash('sha256').update(str).digest('hex')
}

const disallowed: Record<string, boolean> = { __schema: true, __type: true }
export function NoIntrospection (context: any) {
  return {
    Field (node: any) {
      if (disallowed[node.name.value]) {
        context.reportError(
          new GraphQLError('GraphQL introspection is not allowed.', [node])
        )
      }
    }
  }
}
