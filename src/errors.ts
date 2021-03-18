import { GraphQLError } from 'graphql'

export interface FieldError {
  field: string
  message?: string
}
export class ValidationError extends Error {
  public invalidArgs: FieldError[]

  constructor (fielderrors: FieldError[], message?: string) {
    super(message ?? 'Mutation had validation errors.')
    this.invalidArgs = fielderrors
  }
}
export class UnimplementedError extends Error {
  constructor () {
    super('Requested functionality is not yet implemented.')
  }
}

export class GQLError extends Error {
  constructor (message: string, public query: string, public errors: readonly GraphQLError[]) {
    super(message)
  }

  toString () {
    return `${this.message}
${this.errors.map(e => e.message + '\n' + (e.stack ?? '')).join('\n')}
${this.query}`
  }
}

export class ParseError extends GQLError {
  constructor (query: string, errors: readonly GraphQLError[]) {
    super('Failed to parse GraphQL query.', query, errors)
  }
}
export class ExecutionError extends GQLError {
  constructor (query: string, errors: readonly GraphQLError[]) {
    super('Error(s) occurred during GraphQL execution.', query, errors)
  }
}
