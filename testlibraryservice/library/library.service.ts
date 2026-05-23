import { BaseService } from '../../src/index.ts'
import type { LibraryFilter } from './library.model.ts'
import { getLibraries } from './library.database.ts'
import type { Book } from '../book/book.model.ts'

export class LibraryService extends BaseService {
  async find (filter?: LibraryFilter) {
    return await getLibraries(filter)
  }

  async findByBook (book: Book, filter?: LibraryFilter) {
    return await getLibraries({ ...filter, bookIds: [book.id] })
  }
}
