import { BaseService } from '../../src'
import { LibraryFilter } from './library.model'
import { getLibraries } from './library.database'
import { Book } from '../book/book.model'

export class LibraryService extends BaseService {
  async find (filter?: LibraryFilter) {
    return await getLibraries(filter)
  }

  async findByBook (book: Book, filter?: LibraryFilter) {
    return await getLibraries({ ...filter, bookIds: [book.id] })
  }
}
