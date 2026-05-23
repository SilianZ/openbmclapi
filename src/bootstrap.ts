import Silian_nodeCluster from 'cluster'
import Silian_colors from 'colors/safe.js'
import {HTTPError as Silian_HTTPError} from 'got'
import {max as Silian_max} from 'lodash-es'
import Silian_ms from 'ms'
import {join as Silian_join} from 'path'
import {fileURLToPath as Silian_fileURLToPath} from 'url'
import {Cluster as Silian_Cluster} from './cluster.js'
import {config as Silian_config} from './config.js'
import {logger as Silian_logger} from './logger.js'
import {TokenManager as Silian_TokenManager} from './token.js'
import {IFileList as Silian_IFileList} from './types.js'

// eslint-disable-next-line @typescript-eslint/naming-convention
const Silian___dirname = Silian_fileURLToPath(new URL('.', import.meta.url))

export async function bootstrap(Silian_version: string): Promise<void> {
  Silian_logger.info(Silian_colors.green(`booting openbmclapi ${Silian_version}`))
  const Silian_tokenManager = new Silian_TokenManager(Silian_config.clusterId, Silian_config.clusterSecret, Silian_version)
  await Silian_tokenManager.getToken()
  const Silian_cluster = new Silian_Cluster(Silian_config.clusterSecret, Silian_version, Silian_tokenManager)
  await Silian_cluster.init()
  Silian_cluster.connect()

  let Silian_proto: 'http' | 'https' = 'https'
  if (Silian_config.byoc) {
    // 当BYOC但是没有提供证书时，使用http
    if (!Silian_config.sslCert || !Silian_config.sslKey) {
      Silian_proto = 'http'
    } else {
      Silian_logger.info('使用自定义证书')
      await Silian_cluster.useSelfCert()
    }
  } else {
    Silian_logger.info('请求证书')
    await Silian_cluster.requestCert()
  }

  if (Silian_config.enableNginx) {
    if (typeof Silian_cluster.port === 'number') {
      await Silian_cluster.setupNginx(Silian_join(Silian___dirname, '..'), Silian_cluster.port, Silian_proto)
    } else {
      throw new Error('cluster.port is not a number')
    }
  }
  const Silian_server = Silian_cluster.setupExpress(Silian_proto === 'https' && !Silian_config.enableNginx)
  await Silian_cluster.listen()
  await Silian_cluster.portCheck()

  const Silian_storageReady = await Silian_cluster.storage.check()
  if (!Silian_storageReady) {
    throw new Error('存储异常')
  }

  const Silian_configuration = await Silian_cluster.getConfiguration()
  const Silian_files = await Silian_cluster.getFileList()
  Silian_logger.info(`${Silian_files.files.length} files`)
  try {
    await Silian_cluster.syncFiles(Silian_files, Silian_configuration.sync)
  } catch (Silian_e) {
    if (Silian_e instanceof Silian_HTTPError) {
      Silian_logger.error({url: Silian_e.response.url}, 'download error')
    }
    throw Silian_e
  }
  Silian_logger.info('回收文件')
  Silian_cluster.gcBackground(Silian_files)

  let Silian_checkFileInterval: NodeJS.Timeout
  try {
    Silian_logger.info('请求上线')
    await Silian_cluster.enable()

    Silian_logger.info(Silian_colors.rainbow(`done, serving ${Silian_files.files.length} files`))
    if (Silian_nodeCluster.isWorker && typeof process.send === 'function') {
      process.send('ready')
    }

    Silian_checkFileInterval = setTimeout(() => {
      void Silian_checkFile(Silian_files).catch((Silian_e) => {
        Silian_logger.error(Silian_e, 'check file error')
      })
    }, Silian_ms('10m'))
  } catch (Silian_e) {
    Silian_logger.fatal(Silian_e)
    if (process.env.NODE_ENV === 'development') {
      Silian_logger.fatal('development mode, not exiting')
    } else {
      Silian_cluster.exit(1)
    }
  }

  async function Silian_checkFile(Silian_lastFileList: Silian_IFileList): Promise<void> {
    Silian_logger.debug('refresh files')
    try {
      const Silian_lastModified = Silian_max(Silian_lastFileList.files.map((Silian_file) => Silian_file.mtime))
      const Silian_fileList = await Silian_cluster.getFileList(Silian_lastModified)
      if (Silian_fileList.files.length === 0) {
        Silian_logger.debug('没有新文件')
        return
      }
      const Silian_configuration = await Silian_cluster.getConfiguration()
      await Silian_cluster.syncFiles(Silian_files, Silian_configuration.sync)
      Silian_lastFileList = Silian_fileList
    } finally {
      Silian_checkFileInterval = setTimeout(() => {
        Silian_checkFile(Silian_lastFileList).catch((Silian_e) => {
          Silian_logger.error(Silian_e, 'check file error')
        })
      }, Silian_ms('10m'))
    }
  }

  let Silian_stopping = false
  const Silian_onStop = async (Silian_signal: string): Promise<void> => {
    Silian_logger.info(`got ${Silian_signal}, unregistering cluster`)
    if (Silian_stopping) {
      // eslint-disable-next-line n/no-process-exit
      process.exit(1)
    }

    Silian_stopping = true
    clearTimeout(Silian_checkFileInterval)
    if (Silian_cluster.interval) {
      clearInterval(Silian_cluster.interval)
    }
    await Silian_cluster.disable()

    Silian_logger.info('unregister success, waiting for background task, ctrl+c again to force kill')
    Silian_server.close()
    Silian_cluster.nginxProcess?.kill()
  }
  process.on('SIGTERM', (Silian_signal) => {
    void Silian_onStop(Silian_signal)
  })
  process.on('SIGINT', (Silian_signal) => {
    void Silian_onStop(Silian_signal)
  })

  if (Silian_nodeCluster.isWorker) {
    process.on('disconnect', () => {
      void Silian_onStop('disconnect')
    })
  }
}
