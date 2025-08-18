import { HttpError } from 'fastify-txstate'
import { type GraphQLError } from 'graphql'
import { get, isNotNull } from 'txstate-utils'
import { Field, ObjectType, registerEnumType } from 'type-graphql'

export enum MutationMessageType {
  error = 'error',
  warning = 'warning',
  success = 'success'
}

registerEnumType(MutationMessageType, {
  name: 'MutationMessageType',
  valuesConfig: {
    error: {
      description: 'This error means the mutation cannot and/or did not take place.'
    },
    warning: {
      description: 'The mutation can and/or did complete, but the user should receive the warning anyway (e.g. "Your password sucks but I\'ll allow it.").'
    },
    success: {
      description: 'This message should be shown to the end user before submission to let them know ahead of time that one of their entries passed validation (e.g. username available or password strength high).'
    }
  }
})

@ObjectType()
export class MutationMessage {
  @Field(type => String, { nullable: true, description: 'The path to the arg that produced the error. Dot-separated (lodash.get compatible) if it is deep inside an input type. Null if no particular arg can be blamed for the error.' })
  arg?: string

  @Field({ description: 'An error message to be shown to the end user, with the context of the given arg.' })
  message: string

  @Field(type => MutationMessageType, { description: 'The type of error message. See the enum descriptions for more detail.' })
  type: MutationMessageType

  constructor (message: string, arg?: string, type: MutationMessageType = MutationMessageType.error) {
    this.message = message
    this.arg = arg
    this.type = type
  }
}

export interface ValidatedResponseArgs {
  success?: boolean
  messages?: MutationMessage[]
}

@ObjectType()
export class ValidatedResponse {
  @Field({ description: 'True if the mutation succeeded (e.g. saved data or passed validation), even if there were warnings.' })
  success: boolean

  @Field(type => [MutationMessage])
  messages: MutationMessage[]

  constructor (config?: ValidatedResponseArgs) {
    this.messages = config?.messages ?? []
    this.success = config?.success ?? !this.hasErrors()
  }

  /**
   * push message onto messages array and mark not a success if it's fatal
   * @deprecated Use add instead
   */
  addMessage (message: MutationMessage): void
  addMessage (message: string, arg?: string, type?: MutationMessageType): void
  addMessage (messageOrMutationMessage: string | MutationMessage, arg?: string, type?: MutationMessageType): void {
    if (typeof messageOrMutationMessage === 'string') {
      this.messages.push(new MutationMessage(messageOrMutationMessage, arg, type))
    } else {
      this.messages.push(messageOrMutationMessage)
    }
  }

  add (message: MutationMessage) {
    this.addMessage(message)
  }

  // if condition is falsy, error is pushed onto messages list
  assert (condition: boolean, message: string, arg?: string) {
    if (!condition) this.addMessage(message, arg)
  }

  // if input contains arg and is outside allowed range, an error is added to messages
  assertBetween (input: any, arg: string, min: number, max: number) {
    const val = get(input, arg)
    if (isNotNull(val) && (val < min || val > max)) {
      this.addMessage(`Value out of range, must be between ${min} and ${max}`, arg)
    }
  }

  assertPositive (input: any, arg: string) {
    const val = get(input, arg)
    if (val < 0) this.addMessage('Value must not be negative', arg)
  }

  assertLength (input: any, arg: string, min: number, max: number) {
    const val = get(input, arg)
    if (val.length > max) {
      if (typeof val === 'string') this.addMessage('Character maximum exceeded.', arg)
      else this.addMessage('Too many entries.', arg)
    }
    if (val.length < min) {
      if (typeof val === 'string') this.addMessage('Character minimum not met.', arg)
      else this.addMessage('Not enough entries.', arg)
    }
  }

  // do we have errors in our messages array?
  hasErrors () {
    return this.messages.some(m => m.type === MutationMessageType.error)
  }

  /**
   * SomeSpecificTypeOfResponse.error('OMG fail', 'argName')
   *
   * Creates a new error response object for service layer to return upon fatal errors.
   * (e.g. permission denied, object ID does not exist, other "you shall not pass" types of errors)
   *
   * @param message Will be first item in the messages array
   * @param arg Name of the input argument this message relates to
   * @returns ValidatedResponse (whatever class this is being called from)
   */
  static error <R extends ValidatedResponse> (this: new (config: any) => R, message: string, arg?: string) {
    return new this({
      success: false,
      messages: [
        new MutationMessage(message, arg, MutationMessageType.error)
      ]
    })
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
${this.errors.map(e => (e.stack ?? '')).join('\n')}
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
export class AuthError extends HttpError {
  constructor () {
    super(401)
  }
}
