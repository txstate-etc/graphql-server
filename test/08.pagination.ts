import { describe, it } from 'node:test'
import axios from 'axios'
import { expect } from 'chai'
import { basicBookQuery } from './01.basic.ts'

const pagedQuery = 'query ($pagination: ListOptions) { pagedBooks (pagination: $pagination) { id } pageInfo { pagedBooks { page perPage finalPage } } }'

describe('pagination', () => {
  it('should return every result on a single page when no pagination argument is given', async () => {
    const { books, pagedBooks, pageInfo } = await basicBookQuery('{ books { id } pagedBooks { id } pageInfo { pagedBooks { page perPage finalPage } } }')
    expect(pagedBooks.length).to.equal(books.length)
    expect(pageInfo.pagedBooks.page).to.equal(1)
    expect(pageInfo.pagedBooks.finalPage).to.equal(1)
  })

  it('should return a single page of results and report the total number of pages', async () => {
    const { books } = await basicBookQuery('{ books { id } }')
    const total = books.length
    const perPage = 5
    expect(total).to.be.greaterThan(perPage) // otherwise this test proves nothing
    const { pagedBooks, pageInfo } = await basicBookQuery(pagedQuery, { pagination: { page: 1, perPage } })
    expect(pagedBooks.length).to.equal(perPage)
    expect(pageInfo.pagedBooks.page).to.equal(1)
    expect(pageInfo.pagedBooks.perPage).to.equal(perPage)
    expect(pageInfo.pagedBooks.finalPage).to.equal(Math.ceil(total / perPage))
  })

  it('should return different, non-overlapping results for different pages', async () => {
    const { pagedBooks: page1 } = await basicBookQuery(pagedQuery, { pagination: { page: 1, perPage: 5 } })
    const { pagedBooks: page2 } = await basicBookQuery(pagedQuery, { pagination: { page: 2, perPage: 5 } })
    expect(page1.length).to.equal(5)
    expect(page2.length).to.equal(5)
    const idsOnPage1 = new Set(page1.map((b: any) => b.id))
    expect(page2.every((b: any) => !idsOnPage1.has(b.id))).to.equal(true)
  })

  it('should treat a perPage-only pagination argument as paginated', async () => {
    const { pagedBooks, pageInfo } = await basicBookQuery(pagedQuery, { pagination: { perPage: 5 } })
    expect(pagedBooks.length).to.equal(5)
    expect(pageInfo.pagedBooks.page).to.equal(1)
    expect(pageInfo.pagedBooks.perPage).to.equal(5)
  })

  it('should clamp page and perPage values below 1', async () => {
    const { pagedBooks, pageInfo } = await basicBookQuery(pagedQuery, { pagination: { page: -1, perPage: 0 } })
    expect(pageInfo.pagedBooks.page).to.equal(1)
    expect(pageInfo.pagedBooks.perPage).to.equal(1)
    expect(pagedBooks.length).to.equal(1)
  })

  it('should return pageInfo even when it is selected before the paginated field', async () => {
    const reversedQuery = 'query ($pagination: ListOptions) { pageInfo { pagedBooks { page perPage finalPage } } pagedBooks (pagination: $pagination) { id } }'
    const { pagedBooks, pageInfo } = await basicBookQuery(reversedQuery, { pagination: { page: 1, perPage: 5 } })
    expect(pagedBooks.length).to.equal(5)
    expect(pageInfo.pagedBooks.perPage).to.equal(5)
  })

  it('should resolve pageInfo to null when the matching paginated query was not requested', async () => {
    const { pageInfo } = await basicBookQuery('{ pageInfo { pagedBooks { page } } }')
    expect(pageInfo.pagedBooks).to.equal(null)
  })

  it('should report the paginated invocation in pageInfo when the same query is aliased both unpaginated and paginated', async () => {
    // unpaginated alias listed first so it registers first; the paginated one must still win
    const mixedQuery = 'query ($p: ListOptions) { a: pagedBooks { id } b: pagedBooks (pagination: $p) { id } pageInfo { pagedBooks { page perPage finalPage } } }'
    const { a, b, pageInfo } = await basicBookQuery(mixedQuery, { p: { page: 2, perPage: 5 } })
    expect(a.length).to.be.greaterThan(5)
    expect(b.length).to.equal(5)
    expect(pageInfo.pagedBooks.page).to.equal(2)
    expect(pageInfo.pagedBooks.perPage).to.equal(5)
  })

  it('should apply the configured defaultPageSize when a paginated request omits perPage', async () => {
    // the pagedBooks resolver passes defaultPageSize: 7 to executePaginated
    const { books } = await basicBookQuery('{ books { id } }')
    const { pagedBooks, pageInfo } = await basicBookQuery(pagedQuery, { pagination: { page: 1 } })
    expect(pageInfo.pagedBooks.perPage).to.equal(7)
    expect(pagedBooks.length).to.equal(Math.min(7, books.length))
    expect(pageInfo.pagedBooks.finalPage).to.equal(Math.ceil(books.length / 7))
  })

  it('should only report one error when a paginated query fails, resolving its pageInfo to null', async () => {
    // hit the endpoint directly since the shared helper hides the errors array
    const resp = await axios.post('http://basicbookservice/graphql', {
      query: 'query ($f: BookFilter, $p: ListOptions) { pagedBooks (filter: $f, pagination: $p) { id } pageInfo { pagedBooks { finalPage } } }',
      variables: { f: { search: 'throw!' }, p: { page: 1, perPage: 5 } }
    })
    expect(resp.data.errors.length).to.equal(1)
  })

  it('should isolate pagination state for ctx.query() sub-operations', async () => {
    // booksViaSubquery runs pagedBooks (page 1, perPage 3) through a nested ctx.query() while the
    // outer operation also runs pagedBooks paginated; without isolation the nested run would trip
    // the duplicate-request guard and the outer pageInfo could reflect the wrong invocation
    const q = 'query ($p: ListOptions) { pagedBooks (pagination: $p) { id } booksViaSubquery { id } pageInfo { pagedBooks { page perPage } } }'
    const { pagedBooks, booksViaSubquery, pageInfo } = await basicBookQuery(q, { p: { page: 2, perPage: 5 } })
    expect(pagedBooks.length).to.equal(5)
    expect(booksViaSubquery.length).to.equal(3)
    expect(pageInfo.pagedBooks.page).to.equal(2)
    expect(pageInfo.pagedBooks.perPage).to.equal(5)
  })

  it('should error when the same paginated query is requested twice in one operation', async () => {
    try {
      await basicBookQuery('query ($p: ListOptions) { a: pagedBooks (pagination: $p) { id } b: pagedBooks (pagination: $p) { id } }', { p: { page: 1, perPage: 5 } })
      expect.fail('should have thrown because the same paginated query was requested twice')
    } catch (e: any) {
      expect(e.message).to.contain('more than one paginated request')
    }
  })

  it('should apply the requested sort and echo it back in pageInfo', async () => {
    const sortedQuery = 'query ($pagination: ListOptions, $sort: [SortEntryInput!]) { pagedBooks (pagination: $pagination, sort: $sort) { title } pageInfo { pagedBooks { sortOrder { field direction } } } }'
    const { pagedBooks, pageInfo } = await basicBookQuery(sortedQuery, { pagination: { page: 1, perPage: 100 }, sort: [{ field: 'title', direction: 'ASC' }] })
    const titles = pagedBooks.map((b: any) => b.title)
    expect(titles).to.deep.equal([...titles].sort((a: string, b: string) => a.localeCompare(b)))
    expect(pageInfo.pagedBooks.sortOrder).to.deep.equal([{ field: 'title', direction: 'ASC' }])
  })

  it('should default direction to ASC when omitted and echo the default back in pageInfo', async () => {
    const sortedQuery = 'query ($pagination: ListOptions, $sort: [SortEntryInput!]) { pagedBooks (pagination: $pagination, sort: $sort) { title } pageInfo { pagedBooks { sortOrder { field direction } } } }'
    const { pagedBooks, pageInfo } = await basicBookQuery(sortedQuery, { pagination: { page: 1, perPage: 100 }, sort: [{ field: 'title' }] })
    const titles = pagedBooks.map((b: any) => b.title)
    expect(titles).to.deep.equal([...titles].sort((a: string, b: string) => a.localeCompare(b)))
    expect(pageInfo.pagedBooks.sortOrder).to.deep.equal([{ field: 'title', direction: 'ASC' }])
  })
})

const cursorQuery = 'query ($pagination: CursorListOptions) { cursorBooks (pagination: $pagination) { id } pageInfo { cursorBooks { hasNextPage endCursor } } }'

describe('cursor pagination', () => {
  it('should return a page and a cursor that fetches the following, non-overlapping page', async () => {
    const { cursorBooks: page1, pageInfo: info1 } = await basicBookQuery(cursorQuery, { pagination: { perPage: 5 } })
    expect(page1.length).to.equal(5)
    expect(info1.cursorBooks.hasNextPage).to.equal(true)
    expect(info1.cursorBooks.endCursor).to.be.a('string')

    const { cursorBooks: page2 } = await basicBookQuery(cursorQuery, { pagination: { perPage: 5, after: info1.cursorBooks.endCursor } })
    expect(page2.length).to.equal(5)
    const idsOnPage1 = new Set(page1.map((b: any) => b.id))
    expect(page2.every((b: any) => !idsOnPage1.has(b.id))).to.equal(true)
  })

  it('should apply the requested sort to cursor pages and echo the effective sort back', async () => {
    const sortedCursorQuery = 'query ($pagination: CursorListOptions, $sort: [SortEntryInput!]) { cursorBooks (pagination: $pagination, sort: $sort) { title } pageInfo { cursorBooks { endCursor sortOrder { field direction } } } }'
    const { cursorBooks: page1, pageInfo: info1 } = await basicBookQuery(sortedCursorQuery, { pagination: { perPage: 5 }, sort: [{ field: 'title' }] })
    expect(info1.cursorBooks.sortOrder).to.deep.equal([{ field: 'title', direction: 'ASC' }])
    const { cursorBooks: page2 } = await basicBookQuery(sortedCursorQuery, { pagination: { perPage: 5, after: info1.cursorBooks.endCursor }, sort: [{ field: 'title' }] })
    const titles = [...page1, ...page2].map((b: any) => b.title)
    expect(titles).to.deep.equal([...titles].sort((a: string, b: string) => a.localeCompare(b)))

    // with no sort argument the demo service defaults to id order and reports it
    const { pageInfo: infoDefault } = await basicBookQuery(sortedCursorQuery, { pagination: { perPage: 5 } })
    expect(infoDefault.cursorBooks.sortOrder).to.deep.equal([{ field: 'id', direction: 'ASC' }])
  })

  it('should report hasNextPage false once the cursor reaches the end', async () => {
    const { books } = await basicBookQuery('{ books { id } }')
    // walk forward until exhausted, collecting every id exactly once
    const seen: any[] = []
    let after: string | undefined
    let hasNextPage = true
    while (hasNextPage) {
      const { cursorBooks, pageInfo }: any = await basicBookQuery(cursorQuery, { pagination: { perPage: 4, after } })
      seen.push(...cursorBooks.map((b: any) => b.id))
      hasNextPage = pageInfo.cursorBooks.hasNextPage
      after = pageInfo.cursorBooks.endCursor
    }
    expect(seen.length).to.equal(books.length)
    expect(new Set(seen).size).to.equal(books.length)
  })
})
