/* eslint-disable @typescript-eslint/no-unused-expressions */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect } from 'chai'
import { rescue, toArray } from 'txstate-utils'

export type APIBaseQueryPayload = string | Record<string, undefined | string | number | Array<string | number>>
function replaceFiles (variables: Record<string, any>, files: File[]) {
  let newVariables: Record<string, any> | undefined
  for (const key in variables) {
    const val = variables[key]
    if (val instanceof File) {
      files.push(val)
      newVariables ??= { ...variables }
      newVariables[key] = { _type: 'APIUploadInfo', multipartIndex: files.length - 1, name: val.name, mime: val.type, size: val.size }
    } else if (val instanceof Object) {
      const newVal = replaceFiles(val, files)
      if (newVal !== val) {
        newVariables ??= { ...variables }
        newVariables[key] = newVal
      }
    }
  }
  return newVariables ?? variables
}
class API {
  constructor (protected apiBase: string, protected token?: string) {}

  stringifyQuery (query: undefined | APIBaseQueryPayload) {
    if (query == null) return ''
    if (typeof query === 'string') return query.startsWith('?') ? query : '?' + query
    const p = new URLSearchParams()
    for (const [key, val] of Object.entries(query)) {
      for (const v of toArray(val)) p.append(key, String(v))
    }
    return '?' + p.toString()
  }

  protected async request <ReturnType = any> (path: string, method: string, opts?: { body?: any, query?: APIBaseQueryPayload, inlineValidation?: boolean }) {
    const resp = await fetch(this.apiBase + path + this.stringifyQuery(opts?.query), {
      method,
      headers: {
        Authorization: `Bearer ${this.token ?? ''}`,
        Accept: 'application/json',
        ...(opts?.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {})
      },
      body: opts?.body ? (opts.body instanceof FormData ? opts.body : JSON.stringify(opts.body)) : undefined
    })
    const contentType = resp.headers.get('content-type')
    const isJsonResponse = contentType && contentType.includes('application/json')
    if (!resp.ok && !(resp.status === 422 && opts?.inlineValidation)) {
      if (resp.status === 401) {
        throw new Error('401')
      } else {
        const body = (isJsonResponse ? (await rescue(resp.json())) : await rescue(resp.text())) ?? resp.statusText
        let message = ''
        if (typeof body === 'string') message = body
        else if (body.message) message = body.message
        else if (body[0]?.message) message = body[0].message
        throw new Error(message)
      }
    }
    return ((isJsonResponse) ? await resp.json() : await resp.text()) as ReturnType
  }

  async graphql <ReturnType = any> (query: string, variables?: any, querySignature?: string): Promise<ReturnType> {
    const gqlresponse = await this.request('/graphql', 'POST', {
      body: {
        query,
        variables,
        extensions: {
          querySignature
        }
      }
    })
    if (gqlresponse.errors?.length) {
      throw new Error(JSON.stringify(gqlresponse.errors))
    }
    return gqlresponse.data
  }

  async graphqlWithUploads <ReturnType = any> (
    query: string,
    variables: Record<string, any>,
    options?: {
      omitUploads?: boolean
      querySignature?: string
    }
  ): Promise<ReturnType> {
    const files: File[] = []
    variables = replaceFiles(variables, files)

    // If we are only validating, we don't need to upload files
    if (options?.omitUploads || !files.length) return await this.graphql(query, variables, options?.querySignature)

    const form = new FormData()
    form.append('body', JSON.stringify({
      query,
      variables,
      extensions: {
        querySignature: options?.querySignature
      }
    }))
    for (let i = 0; i < files.length; i++) form.append(`file${i}`, files[i])
    const gqlresponse = await this.request('/graphql', 'POST', { body: form })
    if (gqlresponse.errors?.length) {
      throw new Error(JSON.stringify(gqlresponse.errors))
    }
    return gqlresponse.data
  }
}

const bookclient = new API('http://bookservice')

describe('multipart requests', function () {
  it('should automatically accept multipart requests', async () => {
    const buffer = readFileSync(path.join(__dirname, '../blankpdf.pdf')) as unknown as BlobPart
    const { uploadBookData } = await bookclient.graphqlWithUploads('mutation uploadBookData ($file: UploadInfo!) { uploadBookData(file: $file) }', { file: new File([buffer], 'blankpdf.pdf', { type: 'application/pdf' }) })
    expect(uploadBookData).to.deep.equal([1264])
  })
})
