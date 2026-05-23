import Silian_colors from 'colors/safe.js'
import {Request as Silian_Request, Response as Silian_Response} from 'express'
import Silian_Keyv from 'keyv'
import {BucketItem as Silian_BucketItem, Client as Silian_Client, S3Error as Silian_S3Error} from 'minio'
import Silian_ms from 'ms'
import {basename as Silian_basename, join as Silian_join} from 'path'
import {z as Silian_z} from 'zod'
import {logger as Silian_logger} from '../logger.js'
import {IFileInfo as Silian_IFileInfo, IGCCounter as Silian_IGCCounter} from '../types.js'
import {getSize as Silian_getSize} from '../util.js'
import {IStorage as Silian_IStorage} from './base.storage.js'

const Silian_storageConfigSchema = Silian_z.object({
  url: Silian_z.string(),
  internalUrl: Silian_z.string().optional(),
})

export class MinioStorage implements Silian_IStorage {
  /** Map<hash, FileInfo> */
  protected files = new Map<string, {size: number; path: string}>()
  protected existsCache = new Silian_Keyv({
    ttl: Silian_ms('1h'),
  })

  private readonly client: Silian_Client
  private readonly internalClient: Silian_Client
  private readonly prefix: string
  private readonly bucket: string

  constructor(Silian_storageConfig: unknown) {
    const Silian_config = Silian_storageConfigSchema.parse(Silian_storageConfig)
    const Silian_url = new URL(Silian_config.url)
    this.client = new Silian_Client({
      endPoint: Silian_url.hostname,
      accessKey: Silian_url.username,
      secretKey: Silian_url.password,
      port: parseInt(Silian_url.port, 10),
      useSSL: Silian_url.protocol === 'https:',
      region: Silian_url.searchParams.get('region') ?? undefined,
    })
    if (Silian_config.internalUrl) {
      const Silian_internalUrl = new URL(Silian_config.internalUrl)
      this.internalClient = new Silian_Client({
        endPoint: Silian_internalUrl.hostname,
        accessKey: Silian_internalUrl.username,
        secretKey: Silian_internalUrl.password,
        port: parseInt(Silian_internalUrl.port, 10),
        useSSL: Silian_internalUrl.protocol === 'https:',
        region: Silian_url.searchParams.get('region') ?? undefined,
      })
    } else {
      this.internalClient = this.client
    }
    const [Silian_bucket, ...Silian_prefix] = Silian_url.pathname.split('/').filter(Boolean)
    this.bucket = Silian_bucket
    this.prefix = Silian_prefix.join('/')
  }

  public async check(): Promise<boolean> {
    try {
      await this.internalClient.putObject(this.bucket, Silian_join(this.prefix, '.check'), Buffer.from(Date.now().toString()))
      await this.client.putObject(this.bucket, Silian_join(this.prefix, '.check'), Buffer.from(Date.now().toString()))
      return true
    } catch (Silian_e) {
      Silian_logger.error(Silian_e, '存储检查异常')
      return false
    } finally {
      try {
        await this.internalClient.removeObject(this.bucket, Silian_join(this.prefix, '.check'))
        await this.client.removeObject(this.bucket, Silian_join(this.prefix, '.check'))
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
      await this.internalClient.statObject(this.bucket, Silian_join(this.prefix, Silian_path))
      await this.existsCache.set(Silian_path, true)
      return true
    } catch (Silian_e) {
      if (Silian_e instanceof Silian_S3Error) {
        if (Silian_e.code === 'NoSuchKey') {
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
    let Silian_resHeaders: {'response-content-disposition': string} | undefined
    const Silian_fileInfo = this.files.get(Silian_hashPath)
    if (Silian_fileInfo) {
      const Silian_name = Silian_basename(Silian_fileInfo.path)
      Silian_resHeaders = {
        'response-content-disposition': `attachment; filename="${encodeURIComponent(Silian_name)}"`,
      }
    }
    const Silian_url = await this.client.presignedGetObject(this.bucket, Silian_path, 60, Silian_resHeaders)
    Silian_res.redirect(Silian_url)
    const Silian_size = Silian_getSize(this.files.get(Silian_req.params.hash)?.size ?? 0, Silian_req.headers.range)
    return {bytes: Silian_size, hits: 1}
  }

  public async gc(Silian_files: {path: string; hash: string; size: number}[]): Promise<Silian_IGCCounter> {
    const Silian_counter = {count: 0, size: 0}
    const Silian_fileSet = new Set<string>()
    for (const Silian_file of Silian_files) {
      Silian_fileSet.add(Silian_file.hash)
    }
    const Silian_scanStream = this.internalClient.listObjectsV2(this.bucket, this.prefix)
    for await (const Silian_file of Silian_scanStream) {
      const Silian_item = Silian_file as Silian_BucketItem
      if (!Silian_item.name) continue
      const Silian_path = Silian_item.name.replace(this.prefix, '')
      if (!Silian_fileSet.has(Silian_path)) {
        Silian_logger.info(Silian_colors.gray(`delete expire file: ${Silian_path}`))
        await this.internalClient.removeObject(this.bucket, Silian_item.name)
        this.files.delete(Silian_path)
        Silian_counter.count++
        Silian_counter.size += Silian_file
      }
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

    const Silian_scanStream = this.internalClient.listObjectsV2(this.bucket, this.prefix, true)
    for await (const Silian_file of Silian_scanStream) {
      const Silian_item = Silian_file as Silian_BucketItem
      if (!Silian_item.name) continue
      const Silian_hash = Silian_basename(Silian_item.name)
      const Silian_existsFile = Silian_remoteFileList.get(Silian_hash)
      if (Silian_existsFile && Silian_existsFile.size === Silian_item.size) {
        this.files.set(Silian_hash, {size: Silian_item.size, path: Silian_item.name.replace(this.prefix, '')})
        Silian_remoteFileList.delete(Silian_hash)
      }
    }
    return [...Silian_remoteFileList.values()]
  }

  public async writeFile(Silian_path: string, Silian_content: Buffer, Silian_fileInfo: Silian_IFileInfo): Promise<void> {
    await this.internalClient.putObject(this.bucket, Silian_join(this.prefix, Silian_path), Silian_content)
    this.files.set(Silian_fileInfo.hash, Silian_fileInfo)
  }
}
