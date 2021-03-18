import crypto from 'crypto'

export function shasum (str: string) {
  return crypto.createHash('sha256').update(str).digest('hex')
}
