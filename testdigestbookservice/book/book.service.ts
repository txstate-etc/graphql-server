import { BaseService } from '../../src'
import { type BookFilter } from './book.model'
import { getBooks } from './book.database'
import { type Author, type AuthorFilter } from '../author/author.model'

export class BookService extends BaseService {
  async find (filter?: BookFilter) {
    return await getBooks(filter)
  }

  async findById (bookId: number) {
    return (await getBooks({ ids: [bookId] }))?.[0]
  }

  async findByAuthor (author: Author, filter?: AuthorFilter) {
    return await getBooks({ ...filter, authorIds: [author.id] })
  }
}
