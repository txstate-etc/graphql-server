import { isNotNull } from 'txstate-utils'
import { type Book, type BookFilter } from './book.model'

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

export async function getBooks (filter?: BookFilter) {
  let books = filter?.ids ? filter.ids.map(id => bookDb.get(id)).filter(isNotNull) : Array.from(bookDb.values())
  if (filter?.search) {
    const search = filter.search.toLowerCase()
    books = books.filter(book => book.title.toLocaleLowerCase().includes(search))
  }
  if (filter?.authorIds) {
    const authorSet = new Set(filter.authorIds)
    books = books.filter(book => book.authorIds.some(id => authorSet.has(id)))
  }
  return books
}
