import { expect } from 'chai'
import { signAuth, authzQuery } from './01.basic'

describe('query authz tests for direct people endpoint', function () {
  it('should only get self from people endpoint when requesting all people and not part of any meetings', async () => {
    const authn = await signAuth('client_service_test', '4')
    const query = '{ people { id, name, contact } }'
    const headers: Record<string, string> = { Authorization: 'bearer ' + authn }
    const data = await authzQuery(query, {}, { headers })
    expect(data.people.length).equals(1)
    expect(data.people[0].name).equals('Person Four')
    expect(data.people[0].contact).equals('Contact Four')
  })
  it('should only get self with all fields when requesting self', async () => {
    const authn = await signAuth('client_service_test', '4')
    const query = 'query GetPerson($ids:[Int!]) { people(filter:{ ids:$ids }) { id, name, contact } }'
    const headers: Record<string, string> = { Authorization: 'bearer ' + authn }
    const data = await authzQuery(query, { ids: [4] }, { headers })
    expect(data.people.length).equals(1)
    expect(data.people[0].name).equals('Person Four')
    expect(data.people[0].contact).equals('Contact Four')
  })
  it('should get list of people where hosted meeting with full info and only attended meeting with partial info', async () => {
    const authn = await signAuth('client_service_test', '1')
    const query = '{ people { id, contact } }'
    const headers: Record<string, string> = { Authorization: 'bearer ' + authn }
    const data = await authzQuery(query, {}, { headers })
    // Self for 1 (gets full data), Hosted meeting for 2 (gets full data), Attended meeting with 3 (gets partial data)
    expect(data.people.length).equals(3)
    expect(data.people.filter((person: { id: number }) => person.id === 1)[0].contact).equals('Contact One')
    expect(data.people.filter((person: { id: number }) => person.id === 2)[0].contact).equals('Contact Two')
    expect(data.people.filter((person: { id: number }) => person.id === 3)[0].contact).to.equal(null)
  })
  it('should get no people in returned list when requesting a person id with whom you do NOT attend any meetings', async () => {
    const authn = await signAuth('client_service_test', '1')
    const query = 'query GetPersonContact($ids:[Int!]) { people(filter:{ ids:$ids }) { id, contact } }'
    const headers: Record<string, string> = { Authorization: 'bearer ' + authn }
    const data = await authzQuery(query, { ids: [4] }, { headers })
    expect(data.people.length).equals(0)
  })
})
describe('query authz tests for direct meeting endpoint', function () {
  it('should only get the 2 meetings of which we are a member', async () => {
    const authn = await signAuth('client_service_test', '1')
    const query = '{ meetings { id, title } }'
    const headers: Record<string, string> = { Authorization: 'bearer ' + authn }
    const data = await authzQuery(query, {}, { headers })
    expect(data.meetings.length).equals(2)
    expect(data.meetings.filter((meeting: { id: number }) => meeting.id === 1)[0].title).equals('Meeting 1')
    expect(data.meetings.filter((meeting: { id: number }) => meeting.id === 3)[0].title).equals('Meeting 3')
  })
  it('should only get the 1 meetings of which we are a member', async () => {
    const authn = await signAuth('client_service_test', '3')
    const query = '{ meetings { id, title } }'
    const headers: Record<string, string> = { Authorization: 'bearer ' + authn }
    const data = await authzQuery(query, {}, { headers })
    expect(data.meetings.length).equals(1)
    expect(data.meetings[0].title).equals('Meeting 3')
  })
  it('should get no meetings of which we attend none', async () => {
    const authn = await signAuth('client_service_test', '4')
    const query = '{ meetings { id, title } }'
    const headers: Record<string, string> = { Authorization: 'bearer ' + authn }
    const data = await authzQuery(query, {}, { headers })
    expect(data.meetings.length).equals(0)
  })
})
describe('query authz tests for indirect people from meeting endpoint', function () {
  it('should get all meetings where host or member with people info appropriately filtered; No other meetings or people should be visible.', async () => {
    const authn = await signAuth('client_service_test', '1')
    const query = 'query GetMeetingByPerson($ids:[Int!]) { meetings(filter:{ peopleIds:$ids }) { id, title, people { id, name, contact } } }'
    const headers: Record<string, string> = { Authorization: 'bearer ' + authn }
    const data = await authzQuery(query, { PersonIds: [1, 3, 4, 5] }, { headers })
    expect(data.meetings.length).equals(2)
    const meeting1 = data.meetings.filter((meeting: { id: number }) => meeting.id === 1)[0]
    expect(meeting1.people.length).equals(2)
    const meeting1person1 = meeting1.people.filter((person: { id: number }) => person.id === 1)[0]
    expect(meeting1person1.id).equals(1)
    expect(meeting1person1.contact).equals('Contact One')
    const meeting1person2 = meeting1.people.filter((person: { id: number }) => person.id === 2)[0]
    expect(meeting1person2.id).equals(2)
    expect(meeting1person2.contact).equals('Contact Two')

    const meeting3 = data.meetings.filter((meeting: { id: number }) => meeting.id === 3)[0]
    expect(meeting3.people.length).equals(2)
    const meeting3person1 = meeting3.people.filter((person: { id: number }) => person.id === 1)[0]
    expect(meeting3person1.id).equals(1)
    expect(meeting3person1.contact).equals('Contact One')
    const meeting3person3 = meeting3.people.filter((person: { id: number }) => person.id === 3)[0]
    expect(meeting3person3.id).equals(3)
    expect(meeting3person3.contact).to.equal(null)
  })
})
