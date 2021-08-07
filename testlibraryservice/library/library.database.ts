import { isNotNull } from 'txstate-utils'
import { Library, LibraryFilter } from './library.model'

const libraryDb = new Map<number, Library>()

libraryDb.set(1, {
  id: 1,
  bookIds: [1, 3, 5]
})

export async function getLibraries (filter?: LibraryFilter) {
  let libraries = filter?.ids?.map(id => libraryDb.get(id)).filter(isNotNull) ?? Array.from(libraryDb.values())
  if (filter?.bookIds) {
    const bookIdSet = new Set(filter.bookIds)
    libraries = libraries.filter(lb => lb.bookIds.some(id => bookIdSet.has(id)))
  }
  return libraries
}
