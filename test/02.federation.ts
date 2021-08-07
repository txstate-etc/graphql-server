/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai'
import { bookQuery, gatewayQuery, libraryQuery } from './01.basic'

describe('federation endpoints', function () {
  it('should return the SDL for the book service', async () => {
    const { _service } = await bookQuery('{ _service { sdl } }')
    expect(_service.sdl.length).to.be.greaterThan(0)
  })
  it('should return the SDL for the library service', async () => {
    const { _service } = await libraryQuery('{ _service { sdl } }')
    expect(_service.sdl.length).to.be.greaterThan(0)
  })
})

describe('gateway', function () {
  it('should be able to query the book service', async () => {
    const { books } = await gatewayQuery('{ books { title } }')
    expect(books.length).to.be.greaterThan(0)
  })
  it('should be able to query the library service', async () => {
    const { libraries } = await gatewayQuery('{ libraries { id } }')
    expect(libraries.length).to.be.greaterThan(0)
  })
  it('should be able to cross service boundaries from library to books', async () => {
    const { libraries } = await gatewayQuery('{ libraries { books { title } } }')
    for (const lib of libraries) {
      expect(lib.books.length).to.be.greaterThan(0)
      for (const book of lib.books) {
        expect(book.title.length).to.be.greaterThan(0)
      }
    }
  })
  it('should be able to cross service boundaries from book to libraries', async () => {
    const { books } = await gatewayQuery('{ books { title, libraries { id } } }')
    let foundLibWithBooks = false
    for (const book of books) {
      expect(book.libraries).to.be.an('array')
      foundLibWithBooks ||= book.libraries.length > 0
      expect(book.title.length).to.be.greaterThan(0)
      for (const lib of book.libraries) {
        expect(lib.id).to.be.greaterThan(0)
      }
    }
    expect(foundLibWithBooks).to.be.true
  })
  it('should be able to retrieve a field that requires a field from the other graph', async () => {
    const { books } = await gatewayQuery('{ books { upperCaseTitle } }')
    for (const book of books) {
      expect(book.upperCaseTitle.length).to.be.greaterThan(0)
      expect(book.upperCaseTitle).to.not.match(/[a-z]/)
    }
  })
})
