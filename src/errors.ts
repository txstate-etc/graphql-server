import { GraphQLError } from 'graphql'
import { Field, ObjectType, registerEnumType } from 'type-graphql'

export enum MutationErrorType {
  fatal = 'fatal',
  warn = 'warn',
  success = 'success'
}

registerEnumType(MutationErrorType, {
  name: 'MutationErrorType',
  valuesConfig: {
    fatal: {
      description: 'This error means the mutation cannot and/or did not take place.'
    },
    warn: {
      description: 'The mutation can and/or did complete, but the user should receive the warning anyway.'
    },
    success: {
      description: 'This message should be shown to the end user before submission to let them know ahead of time that one of their entries passed validation (e.g. username available or password strength high).'
    }
  }
})

@ObjectType()
export class MutationError {
  @Field({ nullable: true, description: 'The path to the arg that produced the error. Dot-separated (lodash.get compatible) if it is deep inside an input type. Null if no particular arg can be blamed for the error.' })
  arg?: string

  @Field({ description: 'An error message to be shown to the end user, with the context of the given arg.' })
  message: string

  @Field({ description: 'The type of error message. See the enum descriptions for more detail.' })
  type: MutationErrorType

  constructor (message: string, arg?: string, type: MutationErrorType = MutationErrorType.fatal) {
    this.message = message
    this.arg = arg
    this.type = type
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
