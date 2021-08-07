import { isNotNull } from 'txstate-utils'
import { Author, AuthorFilter } from './author.model'

export const authorDb = new Map<number, Author>()
authorDb.set(1, {
  id: 1,
  name: 'Stephen King'
})
authorDb.set(2, {
  id: 2,
  name: 'George Orwell'
})
authorDb.set(3, {
  id: 3,
  name: 'J. K. Rowling'
})
authorDb.set(4, {
  id: 4,
  name: 'Peter Straub'
})

export async function getAuthors (filter?: AuthorFilter) {
  let authors = filter?.ids ? filter.ids.map(id => authorDb.get(id)).filter(isNotNull) : Array.from(authorDb.values())
  if (filter?.search) {
    const search = filter.search.toLowerCase()
    authors = authors.filter(author => author.name.toLocaleLowerCase().includes(search))
  }
  return authors
}
