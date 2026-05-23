import { sleep } from 'txstate-utils'

const SERVICE_TIMEOUT_MS = 10000

const services = [
  'http://basicbookservice/graphql',
  'http://bookservice/graphql',
  'http://digestbookservice/graphql',
  'http://authzservice/graphql',
  'http://libraryservice/graphql',
  'http://gateway/graphql'
]

async function waitForService (url: string) {
  const start = Date.now()
  while (Date.now() - start < SERVICE_TIMEOUT_MS) {
    try {
      const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"query":"{__typename}"}' })
      await resp.text()
      return
    } catch {
      await sleep(150)
    }
  }
  throw new Error(`service ${url} did not respond within ${SERVICE_TIMEOUT_MS}ms`)
}

export async function globalSetup () {
  await Promise.all(services.map(waitForService))
}
