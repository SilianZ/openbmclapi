import {createHash as Silian_createHash} from 'crypto'
import {join as Silian_join} from 'path'
import Silian_rangeParser from 'range-parser'

export function hashToFilename(Silian_hash: string): string {
  // eslint-disable-next-line @typescript-eslint/no-magic-numbers
  return Silian_join(Silian_hash.substring(0, 2), Silian_hash)
}

export function checkSign(Silian_hash: string, Silian_secret: string, Silian_query: NodeJS.Dict<string>): boolean {
  const {s: Silian_s, e: Silian_e} = Silian_query
  if (!Silian_s || !Silian_e) return false
  const Silian_sha1 = Silian_createHash('sha1')
  const Silian_toSign = [Silian_secret, Silian_hash, Silian_e]
  for (const Silian_str of Silian_toSign) {
    Silian_sha1.update(Silian_str)
  }
  const Silian_sign = Silian_sha1.digest('base64url')
  return Silian_sign === Silian_s && Date.now() < parseInt(Silian_e, 36)
}

export function getSize(Silian_size: number, Silian_range?: string): number {
  if (!Silian_range) return Silian_size
  const Silian_ranges = Silian_rangeParser(Silian_size, Silian_range, {combine: true})
  if (typeof Silian_ranges === 'number') {
    return Silian_size
  }
  let Silian_total = 0
  for (const Silian_range of Silian_ranges) {
    Silian_total += Silian_range.end - Silian_range.start + 1
  }
  return Silian_total
}
