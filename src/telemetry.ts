import { exceptionAttributes, HttpError, metrics, recordError, SpanStatusCode, telemetryEnabled, trace, withSpan, type Span } from 'fastify-txstate'
import { type DocumentNode, type ExecutionResult, type GraphQLSchema, isObjectType, Kind, type OperationDefinitionNode, OperationTypeNode, TypeInfo, visit, visitWithTypeInfo } from 'graphql'
import { getMetadataStorage } from 'type-graphql'

/**
 * GraphQL-specific OpenTelemetry, layered on what fastify-txstate already sends for every
 * request. All of it is a no-op unless fastify-txstate found an OTLP endpoint.
 */
const SCOPE = '@txstate-mws/graphql-server'
const tracer = trace.getTracer(SCOPE)

const operationDuration = metrics.getMeter(SCOPE).createHistogram('graphql.server.operation.duration', {
  description: 'Duration of GraphQL operations, from the end of parsing through execution.',
  unit: 's',
  // the same boundaries as http.server.request.duration, so the two can be compared
  advice: { explicitBucketBoundaries: [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10] }
})

const deprecatedFieldUses = metrics.getMeter(SCOPE).createCounter('graphql.server.deprecated_field.uses', {
  description: 'Operations received that select a deprecated field, by schema coordinate.',
  unit: '{operation}'
})
const deprecatedFields = new WeakMap<DocumentNode, string[]>()

/**
 * Notes which deprecated fields a document selects, as `Type.field` schema coordinates, so that
 * countDeprecatedFields has nothing to compute per request. Call it once, when the document is
 * parsed. A field counts if it appears anywhere in the document, whether or not it ends up
 * executing; deprecated arguments and enum values are not counted.
 */
export function findDeprecatedFields (schema: GraphQLSchema, document: DocumentNode) {
  const typeInfo = new TypeInfo(schema)
  const coordinates = new Set<string>()
  visit(document, visitWithTypeInfo(typeInfo, {
    Field () {
      const field = typeInfo.getFieldDef()
      const parent = typeInfo.getParentType()
      if (field?.deprecationReason != null && parent) coordinates.add(`${parent.name}.${field.name}`)
    }
  }))
  if (coordinates.size) deprecatedFields.set(document, Array.from(coordinates))
}

/**
 * Counts an operation against each deprecated field its document selects, so you can tell when
 * one is finally safe to remove, and with `metricsByClient`, who is still using it.
 */
export function countDeprecatedFields (document: DocumentNode, clientId: string | undefined) {
  for (const coordinate of deprecatedFields.get(document) ?? []) deprecatedFieldUses.add(1, { 'graphql.schema.coordinate': coordinate, 'auth.client.id': clientId })
}

/** the operation that will execute: the one named, or else the first in the document */
export function findOperation (document: DocumentNode, operationName?: string) {
  const operations = document.definitions.filter((def): def is OperationDefinitionNode => def.kind === Kind.OPERATION_DEFINITION)
  return operationName == null ? operations[0] : operations.find(op => op.name?.value === operationName)
}

/**
 * What to call the operation in logs, the `after` hook and telemetry: its name, or for an
 * anonymous mutation, the first mutation it runs. `mutation { saveBook(...) { ... } }` is common
 * and would otherwise leave the mutation log with nothing to say what happened.
 */
export function operationLabel (operation: OperationDefinitionNode | undefined, operationName: string | undefined) {
  if (operationName != null || operation?.operation !== OperationTypeNode.MUTATION) return operationName
  return operation.selectionSet.selections.find(s => s.kind === Kind.FIELD)?.name.value
}

const MAX_OPERATION_NAMES = 100
const knownOperationNames = new Set<string>()

/**
 * Operation names are chosen by the client, so they can't be trusted as a metric attribute or in
 * a span name: each distinct value is its own time series. Unless the name comes from a signed
 * query, only the first MAX_OPERATION_NAMES seen keep their name; the rest share `_OTHER`.
 */
export function boundedOperationName (operationName: string | undefined, trusted: boolean) {
  if (operationName == null || trusted || knownOperationNames.has(operationName)) return operationName
  if (knownOperationNames.size >= MAX_OPERATION_NAMES) return '_OTHER'
  knownOperationNames.add(operationName)
  return operationName
}

/**
 * Renames the active (request) span after the operation and gives it the semconv's
 * graphql.operation.* attributes. Call it before opening any child span. The span name gets the
 * bounded name, since backends derive metrics from span names; the attribute gets the real one.
 */
export function describeOperation (operation: OperationDefinitionNode | undefined, operationName: string | undefined, boundedName: string | undefined) {
  if (!operation) return
  const type = operation.operation
  trace.getActiveSpan()
    ?.updateName(boundedName != null && boundedName !== '_OTHER' ? `${type} ${boundedName}` : type)
    .setAttributes({ 'graphql.operation.type': type, 'graphql.operation.name': operationName })
}

const MAX_RECORDED_ERRORS = 10

function errorTypeOf (e: unknown) {
  const type = exceptionAttributes(e)['exception.type']
  return typeof type === 'string' ? type : '_OTHER'
}

/**
 * GraphQL reports resolver failures in the response body with a 200, so fastify-txstate never
 * sees them. This records the ones that are our fault on the active (request) span and as
 * exception log records, and returns the first one's type for the duration metric.
 *
 * Not our fault: a result without `data`, which means execution never began (bad variables or
 * an unknown operation name), and resolvers that threw an HttpError below 500.
 */
export function recordExecutionErrors (result: ExecutionResult) {
  if (!result.errors?.length || result.data === undefined) return undefined
  // one failed dataloader batch rejects every key with the same error; record it once
  const causes = new Set<unknown>()
  for (const error of result.errors) {
    const cause = error.originalError ?? error
    if (!(cause instanceof HttpError && cause.statusCode < 500)) causes.add(cause)
  }
  const recorded = Array.from(causes).slice(0, MAX_RECORDED_ERRORS)
  for (const cause of recorded) recordError(cause)
  return recorded.length ? errorTypeOf(recorded[0]) : undefined
}

export function recordOperationDuration (seconds: number, operation: OperationDefinitionNode | undefined, boundedName: string | undefined, errorType: string | undefined, clientId: string | undefined) {
  operationDuration.record(seconds, { 'graphql.operation.type': operation?.operation, 'graphql.operation.name': boundedName, 'error.type': errorType, 'auth.client.id': clientId })
}

/**
 * `Type.field` for every field backed by a method: `@FieldResolver`s and `@Field` methods on
 * models. Plain properties and getters have nothing worth a span.
 */
function resolverFieldNames () {
  const storage = getMetadataStorage()
  const types = [...storage.objectTypes, ...storage.interfaceTypes]
  const names = new Set<string>()
  for (const objectType of storage.objectTypes) {
    // an object type also has the fields of its superclasses and of the interfaces any of them implement
    const lineage = types.filter(t => t.target === objectType.target || objectType.target.prototype instanceof t.target)
    const interfaces = new Set(lineage.flatMap(t => t.interfaceClasses ?? []))
    for (const type of types) {
      if (!lineage.includes(type) && !interfaces.has(type.target)) continue
      for (const field of type.fields ?? []) {
        const resolver = storage.fieldResolvers.find(r => r.methodName === field.name && r.getObjectType?.() === field.target)
        if (!resolver) continue
        const isMethod = typeof Object.getOwnPropertyDescriptor(field.target.prototype, field.name)?.value === 'function'
        if (resolver.kind === 'external' || isMethod) names.add(`${objectType.name}.${field.schemaName}`)
      }
    }
  }
  return names
}

interface FieldSpan {
  span: Span
  pending: number
  calls: number
  failed: boolean
}
const fieldSpans = new WeakMap<object, Map<string, FieldSpan>>()

/**
 * One span per `Type.field` rather than per call: a field resolved for 500 rows is 500 calls
 * waiting on one dataloader batch, and 500 identical bars would bury the trace. The span opens
 * on the first call and closes once every call has settled, with the number of calls in
 * `graphql.field.calls`. Every call runs inside the span's context, so the queries and requests
 * it makes, including the dataloader batch, nest under it. A call that arrives after the close,
 * like the same field deeper in the query, opens a new span.
 *
 * Only calls that return a promise count. A synchronous resolver did no I/O, so it has nothing
 * to show; we can't know that until it returns, so its span is opened anyway and then never
 * ended, which means never exported.
 */
function inFieldSpan<T> (ctx: object, name: string, resolve: () => T): T {
  let spans = fieldSpans.get(ctx)
  if (!spans) {
    spans = new Map()
    fieldSpans.set(ctx, spans)
  }
  let entry = spans.get(name)
  if (!entry) {
    // no active span means an execution outside any request, like MockContext in a startup task
    if (!trace.getActiveSpan()) return resolve()
    entry = { span: tracer.startSpan(name), pending: 0, calls: 0, failed: false }
    spans.set(name, entry)
  }
  const fieldSpan = entry
  const result = trace.with(fieldSpan.span, resolve)
  if (!(result instanceof Promise)) return result
  const settle = () => {
    fieldSpan.pending -= 1
    if (fieldSpan.pending > 0) return
    if (spans.get(name) === fieldSpan) spans.delete(name)
    fieldSpan.span.setAttribute('graphql.field.calls', fieldSpan.calls)
    fieldSpan.span.end()
  }
  const fail = (e: unknown) => {
    if (!fieldSpan.failed) {
      fieldSpan.failed = true
      fieldSpan.span.setStatus({ code: SpanStatusCode.ERROR })
      fieldSpan.span.setAttribute('error.type', errorTypeOf(e))
      fieldSpan.span.recordException(e as Error)
    }
    settle()
  }
  fieldSpan.pending += 1
  fieldSpan.calls += 1
  result.then(settle).catch(fail)
  return result
}

/**
 * Wraps the schema's resolvers in spans: one per call for root Query and Mutation fields, one
 * per `Type.field` for the rest (see inFieldSpan). We wrap the built schema instead of using a
 * type-graphql global middleware because a middleware also runs for every plain property, and
 * makes each of them asynchronous, even when it has nothing to do.
 */
export function traceResolvers (schema: GraphQLSchema) {
  if (!telemetryEnabled('traces')) return
  const fieldNames = resolverFieldNames()
  const rootTypes = new Set([schema.getQueryType(), schema.getMutationType()])
  for (const type of Object.values(schema.getTypeMap())) {
    if (!isObjectType(type) || type.name.startsWith('__')) continue
    const isRoot = rootTypes.has(type)
    for (const field of Object.values(type.getFields())) {
      const { resolve } = field
      const name = `${type.name}.${field.name}`
      if (!resolve) continue
      if (isRoot) {
        // federation's schema fetch isn't worth a span
        if (field.name !== '_service') field.resolve = (source, args, ctx, info) => withSpan(name, () => resolve(source, args, ctx, info))
      } else if (fieldNames.has(name)) {
        field.resolve = (source, args, ctx: object, info) => inFieldSpan(ctx, name, () => resolve(source, args, ctx, info))
      }
    }
  }
}
