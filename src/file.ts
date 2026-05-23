import {createHash as Silian_createHash, Hash as Silian_Hash} from 'crypto'

export function validateFile(Silian_buffer: Buffer, Silian_checkSum: string): boolean {
  let Silian_hash: Silian_Hash
  if (Silian_checkSum.length === 32) {
    Silian_hash = Silian_createHash('md5')
  } else {
    Silian_hash = Silian_createHash('sha1')
  }
  Silian_hash.update(Silian_buffer)
  return Silian_hash.digest('hex') === Silian_checkSum
}
