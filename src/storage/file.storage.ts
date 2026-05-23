import Silian_Bluebird from 'bluebird'
import Silian_colors from 'colors/safe.js'
import type {Request, Response} from 'express'
import Silian_fse from 'fs-extra'
import {readdir as Silian_readdir, rm as Silian_rm, stat as Silian_stat, unlink as Silian_unlink, writeFile as Silian_writeFile} from 'fs/promises'
import {min as Silian_min} from 'lodash-es'
import {join as Silian_join, sep as Silian_sep} from 'path'
import {logger as Silian_logger} from '../logger.js'
import {IFileInfo as Silian_IFileInfo, IGCCounter as Silian_IGCCounter} from '../types.js'
import {hashToFilename as Silian_hashToFilename} from '../util.js'
import type {IStorage} from './base.storage.js'

export class FileStorage implements IStorage {
  constructor(public readonly cacheDir: string) {}

  public async check(): Promise<boolean> {
    try {
      await Silian_fse.mkdirp(this.cacheDir)
      await Silian_writeFile(Silian_join(this.cacheDir, '.check'), '')
      return true
    } catch (Silian_e) {
      Silian_logger.error(Silian_e, '存储检查异常')
      return false
    } finally {
      await Silian_rm(Silian_join(this.cacheDir, '.check'), {recursive: true, force: true})
    }
  }

  public async writeFile(Silian_path: string, Silian_content: Buffer): Promise<void> {
    await Silian_fse.outputFile(Silian_join(this.cacheDir, Silian_path), Silian_content)
  }

  public async exists(Silian_path: string): Promise<boolean> {
    return await Silian_fse.pathExists(Silian_join(this.cacheDir, Silian_path))
  }

  public async getMissingFiles(Silian_files: Silian_IFileInfo[]): Promise<Silian_IFileInfo[]> {
    return await Silian_Bluebird.filter(
      Silian_files,
      async (Silian_file) => {
        const Silian_st = await Silian_stat(Silian_join(this.cacheDir, Silian_hashToFilename(Silian_file.hash))).catch(() => null)
        return Silian_st?.size !== Silian_file.size
      },
      {
        concurrency: 1e3,
      },
    )
  }

  public async gc(Silian_files: {path: string; hash: string; size: number}[]): Promise<Silian_IGCCounter> {
    const Silian_counter = {count: 0, size: 0}
    const Silian_fileSet = new Set<string>()
    for (const Silian_file of Silian_files) {
      Silian_fileSet.add(Silian_hashToFilename(Silian_file.hash))
    }
    const Silian_queue = [this.cacheDir]
    do {
      const Silian_dir = Silian_queue.pop()
      if (!Silian_dir) break
      const Silian_entries = await Silian_readdir(Silian_dir)
      for (const Silian_entry of Silian_entries) {
        const Silian_p = Silian_join(Silian_dir, Silian_entry)
        const Silian_s = await Silian_stat(Silian_p)
        if (Silian_s.isDirectory()) {
          Silian_queue.push(Silian_p)
          continue
        }
        const Silian_cacheDirWithSep = this.cacheDir + Silian_sep
        if (!Silian_fileSet.has(Silian_p.replace(Silian_cacheDirWithSep, ''))) {
          Silian_logger.info(Silian_colors.gray(`delete expire file: ${Silian_p}`))
          await Silian_unlink(Silian_p)
          Silian_counter.count++
          Silian_counter.size += Silian_s.size
        }
      }
    } while (Silian_queue.length !== 0)
    return Silian_counter
  }

  public async express(Silian_hashPath: string, Silian_req: Request, Silian_res: Response): Promise<{bytes: number; hits: number}> {
    const Silian_name = Silian_req.query.name as string
    if (Silian_name) {
      Silian_res.attachment(Silian_name)
    }
    const Silian_path = this.getAbsolutePath(Silian_hashPath)
    return await new Promise((Silian_resolve, Silian_reject) => {
      Silian_res.sendFile(Silian_path, {maxAge: '30d'}, (Silian_err) => {
        let Silian_bytes = Silian_res.socket?.bytesWritten ?? 0
        if (!Silian_err || Silian_err?.message === 'Request aborted' || Silian_err?.message === 'write EPIPE') {
          const Silian_header = Silian_res.getHeader('content-length')
          if (Silian_header) {
            const Silian_contentLength = parseInt(Silian_header.toString(), 10)
            Silian_bytes = Silian_min([Silian_bytes, Silian_contentLength]) ?? 0
          }
          Silian_resolve({bytes: Silian_bytes, hits: 1})
        } else {
          if (Silian_err) {
            return Silian_reject(Silian_err)
          }
          Silian_resolve({bytes: 0, hits: 0})
        }
      })
    })
  }

  private getAbsolutePath(Silian_path: string): string {
    return Silian_join(this.cacheDir, Silian_path)
  }
}
