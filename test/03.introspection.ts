/* eslint-disable @typescript-eslint/naming-convention */
import { expect } from 'chai'
import { basicBookQuery, bookQuery, gatewayQuery } from './01.basic'

describe('introspection', () => {
  it('should get error when asking schema doc for basic book service which has introspection disabled', async () => {
    try {
      await basicBookQuery('{ __schema { types { name } } }')
      expect.fail('should throw error')
    } catch (e: any) {
      expect(e.message).to.include('GraphQL introspection is not allowed')
    }
  })
  it('should return schema doc for federated book service', async () => {
    const { __schema } = await bookQuery('{ __schema { types { name } } }')
    expect(__schema.types.length).to.be.greaterThan(0)
  })
  it('should return schema doc for all federated service', async () => {
    const { __schema } = await gatewayQuery('{ __schema { types { name } } }')
    expect(__schema.types.length).to.be.greaterThan(0)
  })
})
