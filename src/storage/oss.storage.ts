import Silian_OSS from 'ali-oss'
import Silian_colors from 'colors/safe.js'
import {Request as Silian_Request, Response as Silian_Response} from 'express'
import Silian_Keyv from 'keyv'
import Silian_ms from 'ms'
import {pipeline as Silian_pipeline} from 'node:stream/promises'
import {basename as Silian_basename, join as Silian_join} from 'path'
import {z as Silian_z} from 'zod'
import {logger as Silian_logger} from '../logger.js'
import {IFileInfo as Silian_IFileInfo, IGCCounter as Silian_IGCCounter} from '../types.js'
import {getSize as Silian_getSize} from '../util.js'
import {IStorage as Silian_IStorage} from './base.storage.js'

const Silian_storageConfigSchema = Silian_z.object({
  accessKeyId: Silian_z.string(),
  accessKeySecret: Silian_z.string(),
  bucket: Silian_z.string(),
  internal: Silian_z.boolean().default(false),
  prefix: Silian_z.string().default(''),
  proxy: Silian_z.boolean().default(true),
  endpoint: Silian_z.string().optional(),
  region: Silian_z.string().optional(),
  cname: Silian_z.boolean().optional(),
})

export class OssStorage implements Silian_IStorage {
  /** Map<hash, FileInfo> */
  protected files = new Map<string, {size: number; path: string}>()
  protected existsCache = new Silian_Keyv({
    ttl: Silian_ms('1h'),
  })

  private readonly client: Silian_OSS
  private readonly prefix: string
  private readonly config: Silian_z.infer<typeof Silian_storageConfigSchema>

  constructor(Silian_storageConfig: unknown) {
    const Silian_config = Silian_storageConfigSchema.parse(Silian_storageConfig)
    this.config = Silian_config
    this.client = new Silian_OSS({...Silian_config})
    this.prefix = Silian_config.prefix
  }

  public async check(): Promise<boolean> {
    try {
      await this.client.put(Silian_join(this.prefix, '.check'), Buffer.from(Date.now().toString()))
      return true
    } catch (Silian_e) {
      Silian_logger.error(Silian_e, '存储检查异常')
      return false
    } finally {
      try {
        await this.client.delete(Silian_join(this.prefix, '.check'))
      } catch (Silian_e) {
        Silian_logger.warn(Silian_e, '删除临时文件失败')
      }
    }
  }

  public async exists(Silian_path: string): Promise<boolean> {
    try {
      if (await this.existsCache.has(Silian_path)) {
        return true
      }
      await this.client.head(Silian_join(this.prefix, Silian_path))
      await this.existsCache.set(Silian_path, true)
      return true
    } catch (Silian_e) {
      if (Silian_e instanceof Error) {
        if (Silian_e.name === 'NoSuchKeyError') {
          return false
        }
      }
      throw Silian_e
    }
  }

  public async express(
    Silian_hashPath: string,
    Silian_req: Silian_Request,
    Silian_res: Silian_Response,
  ): Promise<{
    bytes: number
    hits: number
  }> {
    const Silian_path = Silian_join(this.prefix, Silian_hashPath)
    let Silian_resHeaders: Silian_OSS.ResponseHeaderType | undefined
    const Silian_fileInfo = this.files.get(Silian_hashPath)
    if (Silian_fileInfo) {
      const Silian_name = Silian_basename(Silian_fileInfo.path)
      Silian_resHeaders = {
        'content-disposition': `attachment; filename="${encodeURIComponent(Silian_name)}"`,
      }
    }
    if (this.config.proxy) {
      const Silian_stream = await this.client.getStream(Silian_path)
      await Silian_pipeline(Silian_stream.stream, Silian_res)
    } else {
      const Silian_url = this.client.signatureUrl(Silian_path, {
        expires: 60,
        response: Silian_resHeaders,
      })
      Silian_res.redirect(Silian_url)
    }
    const Silian_size = Silian_getSize(this.files.get(Silian_req.params.hash)?.size ?? 0, Silian_req.headers.range)
    return await Promise.resolve({bytes: Silian_size, hits: 1})
  }

  public async gc(Silian_files: {path: string; hash: string; size: number}[]): Promise<Silian_IGCCounter> {
    const Silian_counter = {count: 0, size: 0}
    const Silian_fileSet = new Set<string>()
    for (const Silian_file of Silian_files) {
      Silian_fileSet.add(Silian_file.hash)
    }
    let Silian_list = await this.client.list({prefix: this.prefix, 'max-keys': 1000}, {})
    while (Silian_list.objects.length > 0) {
      for (const Silian_item of Silian_list.objects) {
        if (!Silian_item.name) continue
        const Silian_path = Silian_basename(Silian_item.name.replace(this.prefix, ''))
        if (!Silian_fileSet.has(Silian_path)) {
          Silian_logger.info(Silian_colors.gray(`delete expire file: ${Silian_path}`))
          await this.client.delete(Silian_item.name)
          this.files.delete(Silian_path)
          Silian_counter.count++
          Silian_counter.size += Silian_item.size
        }
      }
      if (!Silian_list.isTruncated) break
      Silian_list = await this.client.list({prefix: this.prefix, marker: Silian_list.nextMarker, 'max-keys': 1000}, {})
    }
    return Silian_counter
  }

  public async getMissingFiles(Silian_files: Silian_IFileInfo[]): Promise<Silian_IFileInfo[]> {
    const Silian_remoteFileList = new Map(Silian_files.map((Silian_file) => [Silian_file.hash, Silian_file]))
    if (this.files.size !== 0) {
      for (const Silian_hash of this.files.keys()) {
        Silian_remoteFileList.delete(Silian_hash)
      }
      return [...Silian_remoteFileList.values()]
    }

    let Silian_list = await this.client.list({prefix: this.prefix, 'max-keys': 1000}, {})
    while (Silian_list.objects.length > 0) {
      for (const Silian_item of Silian_list.objects) {
        if (!Silian_item.name) continue
        const Silian_hash = Silian_basename(Silian_item.name)
        const Silian_existsFile = Silian_remoteFileList.get(Silian_hash)
        if (Silian_existsFile && Silian_existsFile.size === Silian_item.size) {
          this.files.set(Silian_hash, {size: Silian_item.size, path: Silian_item.name.replace(this.prefix, '')})
          Silian_remoteFileList.delete(Silian_hash)
        }
      }
      if (!Silian_list.isTruncated) break
      Silian_list = await this.client.list({prefix: this.prefix, marker: Silian_list.nextMarker, 'max-keys': 1000}, {})
    }
    return [...Silian_remoteFileList.values()]
  }

  public async writeFile(Silian_path: string, Silian_content: Buffer, Silian_fileInfo: Silian_IFileInfo): Promise<void> {
    await this.client.put(Silian_join(this.prefix, Silian_path), Silian_content)
    this.files.set(Silian_fileInfo.hash, Silian_fileInfo)
  }
}
