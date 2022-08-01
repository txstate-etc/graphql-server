import { isNotNull } from 'txstate-utils'
import { Person, PersonFilter } from './person.model'

export const personDb = new Map<number, Person>()
personDb.set(1, {
  id: 1,
  name: 'Person One',
  contact: 'Contact One'
})
personDb.set(2, {
  id: 2,
  name: 'Person Two',
  contact: 'Contact Two'
})
personDb.set(3, {
  id: 3,
  name: 'Person Three',
  contact: 'Contact Three'
})
personDb.set(4, {
  id: 4,
  name: 'Person Four',
  contact: 'Contact Four'
})
personDb.set(5, {
  id: 5,
  name: 'Person Five',
  contact: 'Contact Five'
})

export async function getPeople (filter?: PersonFilter) {
  let people = filter?.ids ? filter.ids.map(id => personDb.get(id)).filter(isNotNull) : Array.from(personDb.values())
  if (filter?.search) {
    const search = filter.search.toLowerCase()
    people = people.filter(person => person.name.toLocaleLowerCase().includes(search))
  }
  return people
}
