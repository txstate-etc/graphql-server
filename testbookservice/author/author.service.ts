import { BaseService } from '../../src/index.ts'
import type { AuthorFilter } from './author.model.ts'
import { getAuthors } from './author.database.ts'
import type { Book } from '../book/book.model.ts'

export class AuthorService extends BaseService {
  async find (filter?: AuthorFilter) {
    return await getAuthors(filter)
  }

  async findByBook (book: Book, filter?: AuthorFilter) {
    return await getAuthors({ ...filter, ids: book.authorIds })
  }
}
