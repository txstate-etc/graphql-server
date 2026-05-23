import { BaseService } from '../../src/index.ts'
import type { BookFilter } from './book.model.ts'
import { getBooks } from './book.database.ts'
import type { Author, AuthorFilter } from '../author/author.model.ts'

export class BookService extends BaseService {
  async find (filter?: BookFilter) {
    return await getBooks(filter)
  }

  async findById (bookId: number) {
    return (await getBooks({ ids: [bookId] })).at(0)
  }

  async findByAuthor (author: Author, filter?: AuthorFilter) {
    return await getBooks({ ...filter, authorIds: [author.id] })
  }
}
