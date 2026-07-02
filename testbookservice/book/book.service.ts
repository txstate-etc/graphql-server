import { BaseService, type CursorResponse, type PaginationResponse } from '../../src/index.ts'
import type { BookFilter } from './book.model.ts'
import { getBooks, getBooksByCursor } from './book.database.ts'
import type { Author, AuthorFilter } from '../author/author.model.ts'

export class BookService extends BaseService {
  async find (filter?: BookFilter, pageInfo?: PaginationResponse) {
    return await getBooks(filter, pageInfo)
  }

  async findByCursor (filter: BookFilter | undefined, pageInfo: CursorResponse) {
    return await getBooksByCursor(filter, pageInfo)
  }

  async findById (bookId: number) {
    return (await getBooks({ ids: [bookId] })).at(0)
  }

  async findByAuthor (author: Author, filter?: AuthorFilter) {
    return await getBooks({ ...filter, authorIds: [author.id] })
  }
}
