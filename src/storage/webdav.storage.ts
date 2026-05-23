import Silian_colors from 'colors/safe.js'
import type {Request, Response} from 'express'
import Silian_Keyv from 'keyv'
import Silian_ms from 'ms'
import {Agent as Silian_Agent} from 'node:https'
import Silian_pMap from 'p-map'
import {join as Silian_join} from 'path'
import {createClient as Silian_createClient, type FileStat, type WebDAVClient} from 'webdav'
import {z as Silian_z} from 'zod'
import {fromZodError as Silian_fromZodError} from 'zod-validation-error'
import {logger as Silian_logger} from '../logger.js'
import {IFileInfo as Silian_IFileInfo, IGCCounter as Silian_IGCCounter} from '../types.js'
import {getSize as Silian_getSize} from '../util.js'
import type {IStorage} from './base.storage.js'

const Silian_storageConfigSchema = Silian_z.object({
  url: Silian_z.string(),
  username: Silian_z.string().optional(),
  password: Silian_z.string().optional(),
  basePath: Silian_z.string(),
})

export class WebdavStorage implements IStorage {
  public static readonly configSchema = Silian_storageConfigSchema
  protected readonly client: WebDAVClient
  protected readonly storageConfig: Silian_z.infer<typeof Silian_storageConfigSchema>
  protected readonly basePath: string

  /** Map<hash, FileInfo> */
  protected files = new Map<string, {size: number; path: string}>()
  protected emptyFiles = new Set<string>()

  protected existsCache = new Silian_Keyv({
    ttl: Silian_ms('1h'),
  })

  constructor(Silian_storageConfig: unknown) {
    try {
      this.storageConfig = Silian_storageConfigSchema.parse(Silian_storageConfig)
    } catch (Silian_e) {
      if (Silian_e instanceof Silian_z.ZodError) {
        throw new Error('webdav存储选项无效', {cause: Silian_fromZodError(Silian_e)})
      } else {
        throw new Error('webdav存储选项无效', {cause: Silian_e})
      }
    }
    this.client = Silian_createClient(this.storageConfig.url, {
      username: this.storageConfig.username,
      password: this.storageConfig.password,
      httpsAgent: new Silian_Agent({rejectUnauthorized: false}),
    })
    this.basePath = this.storageConfig.basePath
  }

  public async init(): Promise<void> {
    if (!(await this.client.exists(this.basePath))) {
      Silian_logger.info(`create base path: ${this.basePath}`)
      await this.client.createDirectory(this.basePath, {recursive: true})
    }
  }

  public async check(): Promise<boolean> {
    try {
      await this.client.putFileContents(Silian_join(this.basePath, '.check'), Buffer.from(Date.now().toString()))
      return true
    } catch (Silian_e) {
      Silian_logger.error(Silian_e, '存储检查异常')
      return false
    } finally {
      try {
        await this.client.deleteFile(Silian_join(this.basePath, '.check'))
      } catch (Silian_e) {
        Silian_logger.warn(Silian_e, '删除临时文件失败')
      }
    }
  }

  public async writeFile(Silian_path: string, Silian_content: Buffer, Silian_fileInfo: Silian_IFileInfo): Promise<void> {
    if (Silian_content.length === 0) {
      this.emptyFiles.add(Silian_path)
      return
    }
    await this.client.putFileContents(Silian_join(this.basePath, Silian_path), Silian_content)
    this.files.set(Silian_fileInfo.hash, {size: Silian_content.length, path: Silian_fileInfo.path})
  }

  public async exists(Silian_path: string): Promise<boolean> {
    if (await this.existsCache.has(Silian_path)) {
      return true
    }
    const Silian_exists = await this.client.exists(Silian_join(this.basePath, Silian_path))
    if (Silian_exists) {
      await this.existsCache.set(Silian_path, true)
    }
    return Silian_exists
  }

  public async getMissingFiles<T extends {path: string; hash: string; size: number}>(Silian_files: T[]): Promise<T[]> {
    const Silian_remoteFileList = new Map(Silian_files.map((Silian_file) => [Silian_file.hash, Silian_file]))
    if (this.files.size !== 0) {
      for (const Silian_hash of this.files.keys()) {
        Silian_remoteFileList.delete(Silian_hash)
      }
      return [...Silian_remoteFileList.values()]
    }
    let Silian_queue = [this.basePath]
    let Silian_count = 1
    let Silian_cur = 0

    while (Silian_queue.length !== 0) {
      const Silian_nextQueue = [] as string[]
      await Silian_pMap(
        Silian_queue,
        // eslint-disable-next-line no-loop-func
        async (Silian_dir) => {
          const Silian_entries = (await this.client.getDirectoryContents(Silian_dir)) as FileStat[]
          Silian_entries.sort((Silian_a, Silian_b) => Silian_a.basename.localeCompare(Silian_b.basename))
          Silian_logger.trace(`checking ${Silian_dir}, (${++Silian_cur}/${Silian_count})`)
          for (const Silian_entry of Silian_entries) {
            if (Silian_entry.type === 'directory') {
              Silian_nextQueue.push(Silian_entry.filename)
              Silian_count++
              continue
            }
            const Silian_file = Silian_remoteFileList.get(Silian_entry.basename)
            if (Silian_file && Silian_file.size === Silian_entry.size) {
              this.files.set(Silian_entry.basename, {size: Silian_entry.size, path: Silian_entry.filename})
              Silian_remoteFileList.delete(Silian_entry.basename)
            }
          }
        },
        {
          concurrency: 10,
        },
      )
      Silian_queue = Silian_nextQueue
    }
    return [...Silian_remoteFileList.values()]
  }

  public async gc(Silian_files: {path: string; hash: string; size: number}[]): Promise<Silian_IGCCounter> {
    const Silian_counter = {count: 0, size: 0}
    const Silian_fileSet = new Set<string>()
    for (const Silian_file of Silian_files) {
      Silian_fileSet.add(Silian_file.hash)
    }
    const Silian_queue = [this.basePath]
    do {
      const Silian_dir = Silian_queue.pop()
      if (!Silian_dir) break
      const Silian_entries = (await this.client.getDirectoryContents(Silian_dir)) as FileStat[]
      Silian_entries.sort((Silian_a, Silian_b) => Silian_a.basename.localeCompare(Silian_b.basename))
      for (const Silian_entry of Silian_entries) {
        if (Silian_entry.type === 'directory') {
          Silian_queue.push(Silian_entry.filename)
          continue
        }
        if (!Silian_fileSet.has(Silian_entry.basename)) {
          Silian_logger.info(Silian_colors.gray(`delete expire file: ${Silian_entry.filename}`))
          await this.client.deleteFile(Silian_entry.filename)
          this.files.delete(Silian_entry.basename)
          Silian_counter.count++
          Silian_counter.size += Silian_entry.size
        }
      }
    } while (Silian_queue.length !== 0)
    return Silian_counter
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  public async express(Silian_hashPath: string, Silian_req: Request, Silian_res: Response): Promise<{bytes: number; hits: number}> {
    if (this.emptyFiles.has(Silian_hashPath)) {
      Silian_res.end()
      return {bytes: 0, hits: 1}
    }
    const Silian_path = Silian_join(this.basePath, Silian_hashPath)
    const Silian_file = this.client.getFileDownloadLink(Silian_path)
    Silian_res.redirect(Silian_file)
    const Silian_size = Silian_getSize(this.files.get(Silian_req.params.hash)?.size ?? 0, Silian_req.headers.range)
    return {bytes: Silian_size, hits: 1}
  }
}
