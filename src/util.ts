import crypto from 'node:crypto'
import { GraphQLError, type ASTVisitor, type FieldNode, type ValidationContext } from 'graphql'

export function shasum (str: string) {
  return crypto.createHash('sha256').update(str).digest('hex')
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
