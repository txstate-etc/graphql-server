import { isNotNull, sortby } from 'txstate-utils'
import { SortDirection, type CursorResponse, type PaginationResponse, type SortEntry } from '../../src/index.ts'
import type { Book, BookFilter } from './book.model.ts'

function applySort (books: Book[], sortOrder: SortEntry[] | undefined) {
  if (!sortOrder?.length) return books
  // sortby takes keys with an optional `true` following a key for descending
  return sortby([...books], ...sortOrder.flatMap(s => s.direction === SortDirection.DESC ? [s.field, true] : [s.field]))
}

export const bookDb = new Map<number, Book>()
const kingBooks = ['Misery', 'It', 'The Shining', 'Carrie', 'The Dead Zone']
const rowlingBooks = ['Harry Potter and the Sorcerer\'s Stone', 'Harry Potter and the Chamber of Secrets', 'Harry Potter and the Prisoner of Azkaban', 'Harry Potter and the Goblet of Fire', 'Harry Potter and the Order of the Phoenix', 'Harry Potter and the Half-Blood Prince', 'Harry Potter and the Deathly Hallows']
bookDb.set(1, {
  id: 1,
  title: 'The Talisman',
  authorIds: [1, 4]
})
bookDb.set(2, {
  id: 2,
  title: '1984',
  authorIds: [2]
})
let id = 3
for (const title of kingBooks) {
  bookDb.set(id, {
    id,
    title,
    authorIds: [1]
  })
  id += 1
}
for (const title of rowlingBooks) {
  bookDb.set(id, {
    id,
    title,
    authorIds: [3]
  })
  id += 1
}

export async function getBooks (filter?: BookFilter, pageInfo?: PaginationResponse) {
  // gives the test suite a way to exercise the error path of a paginated query
  if (filter?.search === 'throw!') throw new Error('simulated backend failure')
  let books = filter?.ids ? filter.ids.map(id => bookDb.get(id)).filter(isNotNull) : Array.from(bookDb.values())
  if (filter?.search) {
    const search = filter.search.toLowerCase()
    books = books.filter(book => book.title.toLocaleLowerCase().includes(search))
  }
  if (filter?.authorIds) {
    const authorSet = new Set(filter.authorIds)
    books = books.filter(book => book.authorIds.some(id => authorSet.has(id)))
  }
  books = applySort(books, pageInfo?.sortOrder)
  if (pageInfo) {
    pageInfo.finalPage = Math.max(1, Math.ceil(books.length / pageInfo.perPage))
    const start = (pageInfo.page - 1) * pageInfo.perPage
    books = books.slice(start, start + pageInfo.perPage)
  }
  return books
}

// Forward-only cursor: the cursor is the id of the last book on the previous page. Mutates the
// given response with hasNextPage/endCursor (and sortOrder when the client didn't send one).
export async function getBooksByCursor (filter: BookFilter | undefined, info: CursorResponse) {
  // apply the effective sort, defaulting to id order, and echo the order actually used
  if (!info.sortOrder?.length) info.sortOrder = [{ field: 'id', direction: SortDirection.ASC }]
  const books = applySort(await getBooks(filter), info.sortOrder)
  // locate the cursor in the sorted list and resume after it; an unknown cursor (or none at all)
  // starts from the beginning
  const start = info.after != null ? books.findIndex(book => String(book.id) === info.after) + 1 : 0
  const page = books.slice(start, start + (info.perPage ?? books.length))
  const last = page.at(-1)
  info.endCursor = last != null ? String(last.id) : undefined
  info.hasNextPage = start + page.length < books.length
  return page
}
