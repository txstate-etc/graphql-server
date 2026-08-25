import { Document } from './document.model.ts'

// module-level instances stand in for a dataloader cache: every request receives the same
// objects, so a removeProperties that mutated instead of cloning would corrupt later requests
const documentDb = [
  new Document({ id: 1, title: 'Meeting Minutes', secret: 'what was really said', ownerId: 1 }),
  new Document({ id: 2, title: 'Budget', secret: 'we are broke', ownerId: 2 })
]

export async function getDocuments () {
  return documentDb
}
