import { after, before, describe, it } from 'node:test'
import { createSecretKey, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import axios from 'axios'
import { expect } from 'chai'
import { SignJWT } from 'jose'
import { sleep } from 'txstate-utils'

interface OtlpAttribute { key: string, value: { stringValue?: string, intValue?: string } }
interface OtlpSpan {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  kind: number
  attributes?: OtlpAttribute[]
  status?: { code?: number }
  events?: { name: string, attributes?: OtlpAttribute[] }[]
}
interface OtlpLogRecord { traceId?: string, attributes?: OtlpAttribute[] }
interface OtlpHistogramPoint { attributes?: OtlpAttribute[], count: string }
interface OtlpMetric { name: string, histogram?: { dataPoints: OtlpHistogramPoint[] }, sum?: { dataPoints: { attributes?: OtlpAttribute[] }[] } }
interface OtlpBody {
  resourceSpans?: { scopeSpans: { spans: OtlpSpan[] }[] }[]
  resourceLogs?: { scopeLogs: { logRecords: OtlpLogRecord[] }[] }[]
  resourceMetrics?: { scopeMetrics: { metrics: OtlpMetric[] }[] }[]
}

const SERVER = 2
const ERROR = 2

function attrs (attributes?: OtlpAttribute[]) {
  return Object.fromEntries((attributes ?? []).map(a => [a.key, a.value.stringValue ?? a.value.intValue]))
}

// otel-collector forwards what authzservice exports here as OTLP JSON, see test/otel-collector.yaml.
// Only this file may listen: node runs each test file in its own process, all in this container.
const spans: OtlpSpan[] = []
const logs: OtlpLogRecord[] = []
const metrics: OtlpMetric[] = []
const sink = createServer((req, res) => {
  const chunks: Buffer[] = []
  req.on('data', (chunk: Buffer) => { chunks.push(chunk) })
  req.on('end', () => {
    const body = JSON.parse(Buffer.concat(chunks).toString()) as OtlpBody
    for (const rs of body.resourceSpans ?? []) for (const ss of rs.scopeSpans) spans.push(...ss.spans)
    for (const rl of body.resourceLogs ?? []) for (const sl of rl.scopeLogs) logs.push(...sl.logRecords)
    for (const rm of body.resourceMetrics ?? []) for (const sm of rm.scopeMetrics) metrics.push(...sm.metrics)
    res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}')
  })
})

const client = axios.create({ baseURL: 'http://authzservice' })

/** sends the query as the continuation of a new trace, so its spans can be found by trace id */
async function traced (query: string, headers?: Record<string, string>) {
  const traceId = randomBytes(16).toString('hex')
  const resp = await client.post<{ data?: any, errors?: { message: string }[] }>('graphql', { query }, { headers: { ...headers, traceparent: `00-${traceId}-${randomBytes(8).toString('hex')}-01` } })
  return { traceId, body: resp.data }
}

const spansFor = (traceId: string) => spans.filter(s => s.traceId === traceId)
const requestSpan = (traceId: string) => spans.find(s => s.traceId === traceId && s.kind === SERVER)
const named = (traceId: string, name: string) => spansFor(traceId).filter(s => s.name === name)
const durationPoints = () => metrics.findLast(m => m.name === 'graphql.server.operation.duration')?.histogram?.dataPoints.map(p => attrs(p.attributes)) ?? []

describe('OpenTelemetry', () => {
  let shelves: string
  let cached: string
  let boom: string
  let refused: string
  let invalid: string
  let anonymousMutation: string
  let anonymousQuery: string
  let overCap: string

  // make every request up front so the tests share one wait on the exporter's 5s flush
  before(async () => {
    sink.listen(4318)
    const shelvesQuery = 'query OtelShelves { shelves { id label summary contents } }'
    const first = await traced(shelvesQuery)
    expect(first.body.data.shelves).to.have.lengthOf(5)
    expect(first.body.data.shelves[0]).to.deep.equal({ id: 1, label: 'Shelf 1', summary: 'Shelf 1 (#1)', contents: 'Contents of shelf 1' })
    shelves = first.traceId
    cached = (await traced(shelvesQuery)).traceId
    const boomed = await traced('query OtelBoom { boom }')
    expect(boomed.body.errors?.[0].message).to.equal('kaboom')
    boom = boomed.traceId
    const wasRefused = await traced('query OtelRefused { refused }')
    expect(wasRefused.body.errors?.[0].message).to.equal('that request can not be processed')
    refused = wasRefused.traceId
    const wasInvalid = await traced('query OtelInvalid { nonexistent }')
    expect(wasInvalid.body.errors).to.have.lengthOf(1)
    invalid = wasInvalid.traceId
    const token = await new SignJWT({ client_id: 'otel-test-client' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer('unified-auth').setSubject('otel').sign(createSecretKey(Buffer.from(process.env.JWT_SECRET!, 'ascii')))
    await traced('query OtelByClient { shelves { id name } }', { Authorization: `bearer ${token}` })
    await traced('query OtelDeprecated { shelves { name } }')
    anonymousMutation = (await traced('mutation { again: restock restock }')).traceId
    anonymousQuery = (await traced('{ shelves { id } }')).traceId
    // more distinct operation names than the server will keep track of
    for (let i = 0; i < 105; i += 1) overCap = (await traced(`query OtelCap${i} { shelves { id } }`)).traceId

    // the over-cap requests were last, so once their telemetry arrives everything before it has too
    const arrived = () => named(overCap, 'Query.shelves').length > 0 && requestSpan(overCap) != null && durationPoints().some(p => p['graphql.operation.name'] === '_OTHER') && logs.some(l => l.traceId === boom)
    for (let i = 0; i < 150; i += 1) {
      if (arrived()) return
      await sleep(200)
    }
    throw new Error('telemetry did not arrive from authzservice')
  })
  after(() => { sink.close() })

  it('names the request span after the operation', () => {
    const span = requestSpan(shelves)!
    expect(span.name).to.equal('query OtelShelves')
    expect(attrs(span.attributes)).to.include({ 'graphql.operation.type': 'query', 'graphql.operation.name': 'OtelShelves', 'http.route': '/graphql' })
    expect(span.status?.code).to.not.equal(ERROR)
  })

  it('names an anonymous mutation after its first mutation', () => {
    const span = requestSpan(anonymousMutation)!
    expect(span.name).to.equal('mutation restock')
    expect(attrs(span.attributes)).to.include({ 'graphql.operation.type': 'mutation', 'graphql.operation.name': 'restock' })
    expect(named(anonymousMutation, 'Mutation.restock')).to.have.lengthOf(2)
    expect(durationPoints()).to.deep.include({ 'graphql.operation.type': 'mutation', 'graphql.operation.name': 'restock' })
    expect(requestSpan(anonymousQuery)!.name).to.equal('query')
    expect(attrs(requestSpan(anonymousQuery)!.attributes)).to.not.have.property('graphql.operation.name')
  })

  it('breaks the duration metric down by client when the server opts in', () => {
    expect(durationPoints().find(p => p['graphql.operation.name'] === 'OtelByClient')).to.include({ 'auth.client.id': 'otel-test-client' })
    expect(durationPoints().find(p => p['graphql.operation.name'] === 'OtelShelves')).to.not.have.property('auth.client.id')
  })

  it('counts the operations that select a deprecated field', () => {
    const uses = metrics.findLast(m => m.name === 'graphql.server.deprecated_field.uses')?.sum?.dataPoints.map(p => attrs(p.attributes))
    expect(uses).to.have.deep.members([
      { 'graphql.schema.coordinate': 'Shelf.name', 'auth.client.id': 'otel-test-client' },
      { 'graphql.schema.coordinate': 'Shelf.name' }
    ])
  })

  it('spans the parse only when the query was not cached', () => {
    expect(named(shelves, 'graphql.parse')).to.have.lengthOf(1)
    expect(named(shelves, 'graphql.parse')[0].parentSpanId).to.equal(requestSpan(shelves)!.spanId)
    expect(requestSpan(cached)!.name).to.equal('query OtelShelves')
    expect(named(cached, 'graphql.parse')).to.have.lengthOf(0)
  })

  it('nests root field spans under the execute span', () => {
    const [execute] = named(shelves, 'graphql.execute')
    expect(execute.parentSpanId).to.equal(requestSpan(shelves)!.spanId)
    expect(named(shelves, 'Query.shelves')).to.have.lengthOf(1)
    expect(named(shelves, 'Query.shelves')[0].parentSpanId).to.equal(execute.spanId)
  })

  it('makes one span for a field resolver called for every row, with the batch nested under it', () => {
    const contents = named(shelves, 'Shelf.contents')
    expect(contents).to.have.lengthOf(1)
    expect(attrs(contents[0].attributes)['graphql.field.calls']).to.equal('5')
    expect(contents[0].parentSpanId).to.equal(named(shelves, 'graphql.execute')[0].spanId)
    const queries = named(shelves, 'fake.db.query')
    expect(queries).to.have.lengthOf(1)
    expect(queries[0].parentSpanId).to.equal(contents[0].spanId)
  })

  it('makes no spans for plain fields or synchronous field methods', () => {
    expect(spansFor(shelves).map(s => s.name)).to.have.members(['query OtelShelves', 'graphql.parse', 'graphql.execute', 'Query.shelves', 'Shelf.contents', 'fake.db.query'])
  })

  it('marks the request failed and sends a log record when a resolver throws', () => {
    const span = requestSpan(boom)!
    expect(span.status?.code).to.equal(ERROR)
    expect(attrs(span.attributes)['error.type']).to.equal('Error')
    expect(attrs(span.events?.find(e => e.name === 'exception')?.attributes)['exception.message']).to.equal('kaboom')
    expect(named(boom, 'Query.boom')[0].status?.code).to.equal(ERROR)
    const records = logs.filter(l => l.traceId === boom)
    expect(records).to.have.lengthOf(1)
    expect(attrs(records[0].attributes)['exception.message']).to.equal('kaboom')
    expect(durationPoints().find(p => p['graphql.operation.name'] === 'OtelBoom')).to.include({ 'graphql.operation.type': 'query', 'error.type': 'Error' })
  })

  it('does not blame the server for client errors', () => {
    for (const traceId of [refused, invalid]) {
      expect(requestSpan(traceId)!.status?.code).to.not.equal(ERROR)
      expect(logs.filter(l => l.traceId === traceId)).to.have.lengthOf(0)
    }
    expect(durationPoints().find(p => p['graphql.operation.name'] === 'OtelRefused')).to.not.have.property('error.type')
  })

  it('stops trusting operation names once it has seen too many', () => {
    // the other test files share this service, so how many names it had already seen is unknown
    const names = durationPoints().map(p => p['graphql.operation.name'])
    expect(names).to.include('_OTHER')
    expect(names).to.not.include('OtelCap104')
    const span = requestSpan(overCap)!
    expect(span.name).to.equal('query')
    expect(attrs(span.attributes)['graphql.operation.name']).to.equal('OtelCap104')
  })
})
