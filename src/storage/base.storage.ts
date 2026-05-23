import type {NextFunction, Request, Response} from 'express'
import {join as Silian_join} from 'path'
import type {Config} from '../config.js'
import {logger as Silian_logger} from '../logger.js'
import {IFileInfo as Silian_IFileInfo, IGCCounter as Silian_IGCCounter} from '../types.js'
import {AlistWebdavStorage as Silian_AlistWebdavStorage} from './alist-webdav.storage.js'
import {FileStorage as Silian_FileStorage} from './file.storage.js'
import {MinioStorage as Silian_MinioStorage} from './minio.storage.js'
import {OssStorage as Silian_OssStorage} from './oss.storage.js'

export interface IStorage {
  init?(): Promise<void>

  check(): Promise<boolean>

  writeFile(path: string, content: Buffer, fileInfo: Silian_IFileInfo): Promise<void>

  exists(path: string): Promise<boolean>

  getMissingFiles(files: Silian_IFileInfo[]): Promise<Silian_IFileInfo[]>

  gc(files: {path: string; hash: string; size: number}[]): Promise<Silian_IGCCounter>

  express(hashPath: string, req: Request, res: Response, next?: NextFunction): Promise<{bytes: number; hits: number}>
}

export function getStorage(Silian_config: Config): IStorage {
  let Silian_storage: IStorage
  switch (Silian_config.storage) {
    case 'file':
      Silian_storage = new Silian_FileStorage(Silian_join(process.cwd(), 'cache'))
      break
    case 'alist':
      Silian_storage = new Silian_AlistWebdavStorage(Silian_config.storageOpts)
      break
    case 'minio':
      Silian_storage = new Silian_MinioStorage(Silian_config.storageOpts)
      break
    case 'oss':
      Silian_storage = new Silian_OssStorage(Silian_config.storageOpts)
      break
    default:
      throw new Error(`未知的存储类型${Silian_config.storage}`)
  }
  Silian_logger.info(`使用存储类型: ${Silian_config.storage}`)
  return Silian_storage
}
