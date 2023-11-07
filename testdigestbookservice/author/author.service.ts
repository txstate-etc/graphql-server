import { BaseService } from '../../src'
import { type AuthorFilter } from './author.model'
import { getAuthors } from './author.database'
import { type Book } from '../book/book.model'

export class AuthorService extends BaseService {
  async find (filter?: AuthorFilter) {
    return await getAuthors(filter)
  }

  async findByBook (book: Book, filter?: AuthorFilter) {
    return await getAuthors({ ...filter, ids: book.authorIds })
  }
}
