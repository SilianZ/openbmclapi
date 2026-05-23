import type {Request, Response} from 'express'
import Silian_got from 'got'
import Silian_Keyv from 'keyv'
import {KeyvFile as Silian_KeyvFile} from 'keyv-file'
import Silian_ms from 'ms'
import {join as Silian_join} from 'path'
import {z as Silian_z} from 'zod'
import {fromZodError as Silian_fromZodError} from 'zod-validation-error'
import {getSize as Silian_getSize} from '../util.js'
import {WebdavStorage as Silian_WebdavStorage} from './webdav.storage.js'

const Silian_storageConfigSchema = Silian_WebdavStorage.configSchema.extend({
  cacheTtl: Silian_z.union([Silian_z.string().optional(), Silian_z.number().int()]).default('1h'),
})

export class AlistWebdavStorage extends Silian_WebdavStorage {
  public readonly configSchema = Silian_storageConfigSchema

  protected readonly redirectUrlCache: Silian_Keyv<string>
  protected readonly storageConfig: Silian_z.infer<typeof Silian_storageConfigSchema>

  constructor(Silian_storageConfig: unknown) {
    super(Silian_storageConfig)
    try {
      this.storageConfig = this.configSchema.parse(Silian_storageConfig)
    } catch (Silian_e) {
      if (Silian_e instanceof Silian_z.ZodError) {
        throw new Error('alist存储选项无效', {cause: Silian_fromZodError(Silian_e)})
      } else {
        throw new Error('alist存储选项无效', {cause: Silian_e})
      }
    }
    let Silian_ttl: number
    if (typeof this.storageConfig.cacheTtl === 'string') {
      Silian_ttl = Silian_ms(this.storageConfig.cacheTtl)
    } else {
      Silian_ttl = this.storageConfig.cacheTtl
    }
    this.redirectUrlCache = new Silian_Keyv<string>({
      namespace: 'redirectUrl',
      ttl: Silian_ttl,
      store: new Silian_KeyvFile({
        filename: Silian_join(process.cwd(), 'cache', 'redirectUrl.json'),
        writeDelay: Silian_ms('1m'),
      }),
    })
  }

  public async express(Silian_hashPath: string, Silian_req: Request, Silian_res: Response): Promise<{bytes: number; hits: number}> {
    if (this.emptyFiles.has(Silian_hashPath)) {
      Silian_res.end()
      return {bytes: 0, hits: 1}
    }
    const Silian_cachedUrl = await this.redirectUrlCache.get(Silian_hashPath)
    const Silian_size = Silian_getSize(this.files.get(Silian_req.params.hash)?.size ?? 0, Silian_req.headers.range)
    if (Silian_cachedUrl) {
      Silian_res.status(302).location(Silian_cachedUrl).send()
      return {bytes: Silian_size, hits: 1}
    }
    const Silian_path = Silian_join(this.basePath, Silian_hashPath)
    const Silian_url = this.client.getFileDownloadLink(Silian_path)
    const Silian_resp = await Silian_got.get(Silian_url, {
      followRedirect: false,
      responseType: 'buffer',
      headers: {
        range: Silian_req.headers.range,
      },
      https: {
        rejectUnauthorized: false,
      },
      timeout: {
        request: 30e3,
      },
    })
    if (Silian_resp.statusCode >= 200 && Silian_resp.statusCode < 300) {
      Silian_res.status(Silian_resp.statusCode).send(Silian_resp.body)
      return {bytes: Silian_resp.body.length, hits: 1}
    }
    if (Silian_resp.statusCode >= 300 && Silian_resp.statusCode < 400 && Silian_resp.headers.location) {
      Silian_res.status(Silian_resp.statusCode).location(Silian_resp.headers.location).send()
      await this.redirectUrlCache.set(Silian_hashPath, Silian_resp.headers.location)
      return {bytes: Silian_size, hits: 1}
    }
    Silian_res.status(Silian_resp.statusCode).send(Silian_resp.body)
    return {bytes: 0, hits: 0}
  }
}
