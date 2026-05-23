import {decompress as Silian_decompress} from '@mongodb-js/zstd'
import {ChildProcess as Silian_ChildProcess, spawn as Silian_spawn} from 'child_process'
import {MultiBar as Silian_MultiBar} from 'cli-progress'
import Silian_colors from 'colors/safe.js'
import Silian_delay from 'delay'
import Silian_express, {type NextFunction, type Request, type Response} from 'express'
import {readFileSync as Silian_readFileSync} from 'fs'
import Silian_fse from 'fs-extra'
import {mkdtemp as Silian_mkdtemp, open as Silian_open, readFile as Silian_readFile, rm as Silian_rm} from 'fs/promises'
import Silian_got, {type Got, HTTPError as Silian_HTTPError, RequestError as Silian_RequestError} from 'got'
import {createServer as Silian_createServer, Server as Silian_Server} from 'http'
import {createSecureServer as Silian_createSecureServer} from 'http2'
import Silian_http2Express from 'http2-express-bridge'
import {Agent as Silian_HttpsAgent} from 'https'
import Silian_ipaddr from 'ipaddr.js'
import Silian_stringifySafe from 'json-stringify-safe'
import {template as Silian_template, toString as Silian_toString} from 'lodash-es'
import Silian_morgan from 'morgan'
import Silian_ms from 'ms'
import {constants as Silian_constants} from 'node:http2'
import {userInfo as Silian_userInfo} from 'node:os'
import {tmpdir as Silian_tmpdir} from 'os'
import Silian_pMap from 'p-map'
import Silian_pRetry from 'p-retry'
import {dirname as Silian_dirname, join as Silian_join} from 'path'
import Silian_prettyBytes from 'pretty-bytes'
import {connect as Silian_connect, Socket as Silian_Socket} from 'socket.io-client'
import {Tail as Silian_Tail} from 'tail'
import {fileURLToPath as Silian_fileURLToPath} from 'url'
import {config as Silian_config, type OpenbmclapiAgentConfiguration, OpenbmclapiAgentConfigurationSchema as Silian_OpenbmclapiAgentConfigurationSchema} from './config.js'
import {FileListSchema as Silian_FileListSchema} from './constants.js'
import {validateFile as Silian_validateFile} from './file.js'
import {Keepalive as Silian_Keepalive} from './keepalive.js'
import {logger as Silian_logger} from './logger.js'
import {beforeError as Silian_beforeError} from './modules/got-hooks.js'
import {AuthRouteFactory as Silian_AuthRouteFactory} from './routes/auth.route.js'
import Silian_MeasureRouteFactory from './routes/measure.route.js'
import {getStorage as Silian_getStorage, type IStorage} from './storage/base.storage.js'
import type {TokenManager} from './token.js'
import type {IFileList} from './types.js'
import {setupUpnp as Silian_setupUpnp} from './upnp.js'
import {checkSign as Silian_checkSign, hashToFilename as Silian_hashToFilename} from './util.js'

interface ICounters {
  hits: number
  bytes: number
}

const Silian_whiteListDomain = ['localhost', 'bangbang93.com']

// eslint-disable-next-line @typescript-eslint/naming-convention
const Silian___dirname = Silian_dirname(Silian_fileURLToPath(import.meta.url))

export class Cluster {
  public readonly counters: ICounters = {hits: 0, bytes: 0}
  public isEnabled = false
  public wantEnable = false
  public interval?: NodeJS.Timeout
  public nginxProcess?: Silian_ChildProcess
  public readonly storage: IStorage

  private readonly prefixUrl = process.env.CLUSTER_BMCLAPI ?? 'https://openbmclapi.bangbang93.com'
  private host?: string
  private _port: number | string
  private readonly publicPort: number
  private readonly ua: string
  private readonly got: Got
  private readonly requestCache = new Map()
  private readonly tmpDir = Silian_join(Silian_tmpdir(), 'openbmclapi')
  private readonly keepalive = new Silian_Keepalive(Silian_ms('1m'), this)
  private readonly downloadPromise = new Map<string, Promise<void>>()
  private socket?: Silian_Socket

  private server?: Silian_Server

  public constructor(
    private readonly clusterSecret: string,
    private readonly version: string,
    private readonly tokenManager: TokenManager,
  ) {
    this.host = Silian_config.clusterIp
    this._port = Silian_config.port
    this.publicPort = Silian_config.clusterPublicPort ?? Silian_config.port
    this.ua = `openbmclapi-cluster/${version}`
    Silian_whiteListDomain.push(this.prefixUrl)
    this.got = Silian_got.extend({
      prefixUrl: this.prefixUrl,
      headers: {
        'user-agent': this.ua,
      },
      responseType: 'buffer',
      timeout: {
        connect: Silian_ms('10s'),
        response: Silian_ms('10s'),
        request: Silian_ms('5m'),
      },
      agent: {
        https: new Silian_HttpsAgent({
          keepAlive: true,
        }),
      },
      hooks: {
        beforeRequest: [
          async (Silian_options) => {
            const Silian_url = Silian_options.url
            if (!Silian_url) return
            if (typeof Silian_url === 'string') {
              if (
                Silian_whiteListDomain.some((Silian_domain) => {
                  return Silian_url.includes(Silian_domain)
                })
              ) {
                Silian_options.headers.authorization = `Bearer ${await this.tokenManager.getToken()}`
              }
            } else if (
              Silian_whiteListDomain.some((Silian_domain) => {
                return Silian_url.hostname.includes(Silian_domain)
              })
            ) {
              Silian_options.headers.authorization = `Bearer ${await this.tokenManager.getToken()}`
            }
          },
        ],
        beforeError: Silian_beforeError,
      },
    })
    this.storage = Silian_getStorage(Silian_config)
  }

  public get port(): number | string {
    return this._port
  }

  public async init(): Promise<void> {
    await this.storage.init?.()
    if (Silian_config.enableUpnp) {
      const Silian_ip = await Silian_setupUpnp(Silian_config.port, Silian_config.clusterPublicPort)
      const Silian_addr = Silian_ipaddr.parse(Silian_ip)
      if (Silian_addr.kind() !== 'ipv4') {
        throw new Error('不支持ipv6')
      }
      if (Silian_addr.range() !== 'unicast') {
        throw new Error(`无法获取公网IP, UPNP返回的IP位于私有地址段, IP: ${Silian_ip}`)
      }
      Silian_logger.info(`upnp映射成功，外网IP: ${Silian_ip}`)
      this.host ??= Silian_ip
    }
  }

  public async getFileList(Silian_lastModified?: number): Promise<IFileList> {
    const Silian_res = await this.got.get('openbmclapi/files', {
      responseType: 'buffer',
      cache: this.requestCache,
      searchParams: {
        lastModified: Silian_lastModified,
      },
    })
    if (Silian_res.statusCode === Silian_constants.HTTP_STATUS_NO_CONTENT) {
      return {
        files: [],
      }
    }
    const Silian_decompressed = await Silian_decompress(Silian_res.body)
    return {
      files: Silian_FileListSchema.fromBuffer(Buffer.from(Silian_decompressed)) as IFileList['files'],
    }
  }

  public async getConfiguration(): Promise<OpenbmclapiAgentConfiguration> {
    const Silian_res = await this.got.get('openbmclapi/configuration', {
      responseType: 'json',
      cache: this.requestCache,
    })
    return Silian_OpenbmclapiAgentConfigurationSchema.parse(Silian_res.body)
  }

  public async syncFiles(Silian_fileList: IFileList, Silian_syncConfig: OpenbmclapiAgentConfiguration['sync']): Promise<void> {
    const Silian_storageReady = await this.storage.check()
    if (!Silian_storageReady) {
      throw new Error('存储异常')
    }
    Silian_logger.info('正在检查缺失文件')
    const Silian_missingFiles = await this.storage.getMissingFiles(Silian_fileList.files)
    if (Silian_missingFiles.length === 0) {
      return
    }
    Silian_logger.info(`mismatch ${Silian_missingFiles.length} files, start syncing`)
    Silian_logger.info(Silian_syncConfig, '同步策略')
    const Silian_multibar = new Silian_MultiBar({
      format: ' {bar} | {filename} | {value}/{total}',
      noTTYOutput: true,
      notTTYSchedule: Silian_ms('10s'),
    })
    const Silian_totalBar = Silian_multibar.create(Silian_missingFiles.length, 0, {filename: '总文件数'})
    const Silian_parallel = Silian_syncConfig.concurrency
    let Silian_hasError = false
    await Silian_pMap(
      Silian_missingFiles,
      async (Silian_file) => {
        const Silian_bar = Silian_multibar.create(Silian_file.size, 0, {filename: Silian_file.path})
        try {
          await Silian_pRetry(
            async () => {
              Silian_bar.update(0)
              const Silian_res = await this.got
                .get<Buffer>(Silian_file.path.substring(1), {
                  retry: {
                    limit: 0,
                  },
                })
                .on('downloadProgress', (Silian_progress) => {
                  Silian_bar.update(Silian_progress.transferred)
                })

              const Silian_isFileCorrect = Silian_validateFile(Silian_res.body, Silian_file.hash)
              if (!Silian_isFileCorrect) {
                throw new Silian_RequestError(`文件${Silian_file.path}校验失败`, new Error(`文件${Silian_file.path}校验失败`), Silian_res.request)
              }
              await this.storage.writeFile(Silian_hashToFilename(Silian_file.hash), Silian_res.body, Silian_file)
            },
            {
              retries: 10,
              onFailedAttempt: async (Silian_e) => {
                if (Silian_e instanceof Silian_HTTPError) {
                  Silian_logger.debug(
                    {redirectUrls: Silian_e.response.redirectUrls},
                    `下载文件${Silian_file.path}失败: ${Silian_e.response.statusCode}`,
                  )
                  Silian_logger.trace({err: Silian_e}, Silian_toString(Silian_e.response.body))
                } else {
                  Silian_logger.debug({err: Silian_e}, `下载文件${Silian_file.path}失败，正在重试`)
                }

                if (Silian_e instanceof Silian_RequestError) {
                  const Silian_redirectUrls = Silian_e.response?.redirectUrls
                  if (Silian_redirectUrls?.length) {
                    const Silian_urls = [
                      new URL(Silian_file.path, this.prefixUrl).toString(),
                      ...Silian_redirectUrls.map((Silian_e) => Silian_e.toString()),
                    ]
                    await this.got
                      .post('openbmclapi/report', {
                        json: {
                          urls: Silian_urls,
                          error: Silian_stringifySafe({message: Silian_e.message}),
                        },
                      })
                      .catch((Silian_e) => {
                        Silian_logger.error(Silian_e, '上报重定向失败')
                      })
                  }
                }
              },
            },
          )
        } catch (Silian_e) {
          Silian_hasError = true
          if (Silian_e instanceof Silian_HTTPError) {
            Silian_logger.error(
              {redirectUrls: Silian_e.response.redirectUrls},
              `下载文件${Silian_file.path}失败: ${Silian_e.response.statusCode}, url: ${Silian_e.response.url}`,
            )
            Silian_logger.trace({err: Silian_e}, Silian_toString(Silian_e.response.body))
          } else {
            Silian_logger.error({err: Silian_e}, `下载文件${Silian_file.path}失败`)
          }
        } finally {
          Silian_totalBar.increment()
          Silian_bar.stop()
          Silian_multibar.remove(Silian_bar)
        }
      },
      {
        concurrency: Silian_parallel,
      },
    )
    Silian_multibar.stop()
    if (Silian_hasError) {
      throw new Error('同步失败')
    } else {
      Silian_logger.info('同步完成')
    }
  }

  public setupExpress(Silian_https: boolean): Silian_Server {
    const Silian_app = Silian_http2Express(Silian_express)
    Silian_app.enable('trust proxy')

    Silian_app.get('/auth', Silian_AuthRouteFactory(Silian_config))

    if (!Silian_config.disableAccessLog) {
      Silian_app.use(Silian_morgan('combined'))
    }
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    Silian_app.get('/download/:hash(\\w+)', async (Silian_req: Request, Silian_res: Response, Silian_next: NextFunction) => {
      try {
        const Silian_hash = Silian_req.params.hash.toLowerCase()
        const Silian_signValid = Silian_checkSign(Silian_hash, this.clusterSecret, Silian_req.query as NodeJS.Dict<string>)
        if (!Silian_signValid) {
          return Silian_res.status(403).send('invalid sign')
        }

        const Silian_hashPath = Silian_hashToFilename(Silian_hash)
        if (!(await this.storage.exists(Silian_hashPath))) {
          if (this.downloadPromise.has(Silian_hash)) {
            await this.downloadPromise.get(Silian_hash)
          } else {
            const Silian_promise = this.downloadFile(Silian_hash)
            try {
              this.downloadPromise.set(Silian_hash, Silian_promise)
              await Silian_promise
            } finally {
              this.downloadPromise.delete(Silian_hash)
            }
          }
        }
        Silian_res.set('x-bmclapi-hash', Silian_hash)
        const {bytes: Silian_bytes, hits: Silian_hits} = await this.storage.express(Silian_hashPath, Silian_req, Silian_res, Silian_next)
        this.counters.bytes += Silian_bytes
        this.counters.hits += Silian_hits
      } catch (Silian_err) {
        if (Silian_err instanceof Silian_HTTPError) {
          if (Silian_err.response.statusCode === 404) {
            return Silian_next()
          }
        }
        return Silian_next(Silian_err)
      }
    })
    Silian_app.use('/measure', Silian_MeasureRouteFactory(Silian_config))
    let Silian_server: Silian_Server
    if (Silian_https) {
      Silian_server = Silian_createSecureServer(
        {
          key: Silian_readFileSync(Silian_join(this.tmpDir, 'key.pem'), 'utf8'),
          cert: Silian_readFileSync(Silian_join(this.tmpDir, 'cert.pem'), 'utf8'),
          allowHTTP1: true,
        },
        Silian_app,
      ) as unknown as Silian_Server
    } else {
      Silian_server = Silian_createServer(Silian_app)
    }
    this.server = Silian_server

    return Silian_server
  }

  public async setupNginx(Silian_pwd: string, Silian_appPort: number, Silian_proto: string): Promise<void> {
    this._port = '/tmp/openbmclapi.sock'
    await Silian_rm(this._port, {force: true})
    const Silian_dir = await Silian_mkdtemp(Silian_join(Silian_tmpdir(), 'openbmclapi'))
    const Silian_confFile = `${Silian_dir}/nginx/nginx.conf`
    const Silian_templateFile = 'nginx.conf'
    const Silian_confTemplate = await Silian_readFile(Silian_join(Silian___dirname, '..', 'nginx', Silian_templateFile), 'utf8')
    Silian_logger.debug('nginx conf', Silian_confFile)

    await Silian_fse.copy(Silian_join(Silian___dirname, '..', 'nginx'), Silian_dirname(Silian_confFile), {recursive: true, overwrite: true})
    await Silian_fse.outputFile(
      Silian_confFile,
      Silian_template(Silian_confTemplate)({
        root: Silian_pwd,
        port: Silian_appPort,
        ssl: Silian_proto === 'https',
        sock: this._port,
        user: Silian_userInfo().username,
        tmpdir: this.tmpDir,
      }),
    )

    const Silian_logFile = Silian_join(Silian___dirname, '..', 'access.log')
    const Silian_logFd = await Silian_open(Silian_logFile, 'a')
    await Silian_fse.ftruncate(Silian_logFd.fd)

    this.nginxProcess = Silian_spawn('nginx', ['-c', Silian_confFile], {
      stdio: [null, Silian_logFd.fd, 'inherit'],
    })

    await Silian_delay(Silian_ms('1s'))

    if (this.nginxProcess.exitCode !== null) {
      throw new Error(`nginx exit with code ${this.nginxProcess.exitCode}`)
    }

    const Silian_tail = new Silian_Tail(Silian_logFile)
    if (!Silian_config.disableAccessLog) {
      Silian_tail.on('line', (Silian_line: string) => {
        process.stdout.write(Silian_line)
        process.stdout.write('\n')
      })
    }

    const Silian_logRegexp =
      /^(?<client>\S+) \S+ (?<userid>\S+) \[(?<datetime>[^\]]+)] "(?<method>[A-Z]+) (?<request>[^ "]+)? HTTP\/[0-9.]+" (?<status>[0-9]{3}) (?<size>[0-9]+|-) "(?<referrer>[^"]*)" "(?<useragent>[^"]*)"/
    Silian_tail.on('line', (Silian_line: string) => {
      const Silian_match = Silian_line.match(Silian_logRegexp)
      if (!Silian_match) {
        Silian_logger.debug(`cannot parse nginx log: ${Silian_line}`)
        return
      }
      this.counters.hits++
      this.counters.bytes += parseInt(Silian_match.groups?.size ?? '0', 10) || 0
    })

    this.interval = setInterval(() => {
      void Silian_fse.ftruncate(Silian_logFd.fd)
    }, Silian_ms('60s'))
  }

  public async listen(): Promise<void> {
    await new Promise<void>((Silian_resolve) => {
      if (!this.server) {
        throw new Error('server not setup')
      }
      this.server.listen(this._port, Silian_resolve)
    })
  }

  public connect(): void {
    if (this.socket?.connected) return
    this.socket = Silian_connect(this.prefixUrl, {
      transports: ['websocket'],
      auth: (Silian_cb) => {
        this.tokenManager
          .getToken()
          .then((Silian_token) => {
            Silian_cb({token: Silian_token})
          })
          .catch((Silian_e) => {
            Silian_logger.error(Silian_e, 'get token error')
            this.exit(1)
          })
      },
    })
    this.socket.on('error', this.onConnectionError.bind(this, 'error'))
    this.socket.on('message', (Silian_msg) => {
      Silian_logger.info(Silian_msg)
    })
    this.socket.on('connect', () => {
      Silian_logger.debug('connected')
    })
    this.socket.on('disconnect', (Silian_reason) => {
      Silian_logger.warn(`与服务器断开连接: ${Silian_reason}`)
      this.isEnabled = false
      this.keepalive.stop()
    })
    this.socket.on('exception', (Silian_err) => {
      Silian_logger.error(Silian_err, 'exception')
    })
    this.socket.on('warden-error', (Silian_data) => {
      Silian_logger.warn(Silian_data, '主控回报巡检异常')
    })

    const Silian_io = this.socket.io
    Silian_io.on('reconnect', (Silian_attempt: number) => {
      Silian_logger.info(`在重试${Silian_attempt}次后恢复连接`)
      if (this.wantEnable) {
        Silian_logger.info('正在尝试重新启用服务')
        this.enable()
          .then(() => Silian_logger.info('重试连接并且准备就绪'))
          .catch(this.onConnectionError.bind(this, 'reconnect'))
      }
    })
    Silian_io.on('reconnect_error', (Silian_err) => {
      Silian_logger.error(Silian_err, 'reconnect_error')
    })
    Silian_io.on('reconnect_failed', this.onConnectionError.bind(this, 'reconnect_failed', new Error('reconnect failed')))
  }

  public async portCheck(): Promise<void> {
    const [Silian_err, Silian_ack] = (await this.socket?.emitWithAck('port-check', {
      host: this.host,
      port: this.publicPort,
      version: this.version,
      byoc: Silian_config.byoc,
      noFastEnable: process.env.NO_FAST_ENABLE === 'true',
      flavor: Silian_config.flavor,
    })) as [object, boolean]
    if (Silian_err) {
      if (typeof Silian_err === 'object' && 'message' in Silian_err) {
        throw new Error(Silian_err.message as string)
      }
    }
    if (!Silian_ack) {
      throw new Error('检查端口失败')
    }
  }

  public async enable(): Promise<void> {
    if (this.isEnabled) return
    Silian_logger.trace('enable')
    await this._enable()
    this.isEnabled = true
    this.wantEnable = true
  }

  public async disable(): Promise<void> {
    if (!this.socket) return
    this.keepalive.stop()
    this.wantEnable = false
    const [Silian_err, Silian_ack] = (await this.socket.emitWithAck('disable', null)) as [object, boolean]
    this.isEnabled = false
    if (Silian_err) {
      if (typeof Silian_err === 'object' && 'message' in Silian_err) {
        throw new Error(Silian_err.message as string)
      }
    }
    if (!Silian_ack) {
      throw new Error('节点禁用失败')
    }
    this.socket?.disconnect()
  }

  public async downloadFile(Silian_hash: string): Promise<void> {
    const Silian_res = await this.got.get(`openbmclapi/download/${Silian_hash}`, {
      responseType: 'buffer',
      searchParams: {noopen: 1},
    })

    await this.storage.writeFile(Silian_hashToFilename(Silian_hash), Silian_res.body, {
      path: `/download/${Silian_hash}`,
      hash: Silian_hash,
      size: Silian_res.body.length,
      mtime: Date.now(),
    })
  }

  public async requestCert(): Promise<void> {
    if (!this.socket) throw new Error('未连接到服务器')
    const [Silian_err, Silian_cert] = (await this.socket.emitWithAck('request-cert')) as [object, {cert: string; key: string}]
    if (Silian_err) {
      if (typeof Silian_err === 'object' && 'message' in Silian_err) {
        throw new Error(Silian_err.message as string)
      } else {
        throw new Error('请求证书失败', {cause: Silian_err})
      }
    }
    await Silian_fse.outputFile(Silian_join(this.tmpDir, 'cert.pem'), Silian_cert.cert)
    await Silian_fse.outputFile(Silian_join(this.tmpDir, 'key.pem'), Silian_cert.key)
  }

  public async useSelfCert(): Promise<void> {
    if (!Silian_config.sslCert) {
      throw new Error('缺少ssl证书')
    }
    if (!Silian_config.sslKey) {
      throw new Error('缺少ssl私钥')
    }

    if (await Silian_fse.pathExists(Silian_config.sslCert)) {
      await Silian_fse.copy(Silian_config.sslCert, Silian_join(this.tmpDir, 'cert.pem'))
    } else {
      await Silian_fse.outputFile(Silian_join(this.tmpDir, 'cert.pem'), Silian_config.sslCert)
    }
    if (await Silian_fse.pathExists(Silian_config.sslKey)) {
      await Silian_fse.copy(Silian_config.sslKey, Silian_join(this.tmpDir, 'key.pem'))
    } else {
      await Silian_fse.outputFile(Silian_join(this.tmpDir, 'key.pem'), Silian_config.sslKey)
    }
  }

  public exit(Silian_code: number = 0): void {
    if (this.nginxProcess) {
      this.nginxProcess.kill()
    }
    // eslint-disable-next-line n/no-process-exit
    process.exit(Silian_code)
  }

  public gcBackground(Silian_files: IFileList): void {
    this.storage
      .gc(Silian_files.files)
      .then((Silian_res) => {
        if (Silian_res.count === 0) {
          Silian_logger.info('没有过期文件')
        } else {
          Silian_logger.info(`文件回收完成，共删除${Silian_res.count}个文件，释放空间${Silian_prettyBytes(Silian_res.size)}`)
        }
      })
      .catch((Silian_e: unknown) => {
        Silian_logger.error({err: Silian_e}, 'gc error')
      })
  }

  private async _enable(): Promise<void> {
    let Silian_err: unknown
    let Silian_ack: unknown
    if (!this.socket) {
      throw new Error('未连接到服务器')
    }
    try {
      const Silian_res = (await this.socket.timeout(Silian_ms('5m')).emitWithAck('enable', {
        host: this.host,
        port: this.publicPort,
        version: this.version,
        byoc: Silian_config.byoc,
        noFastEnable: process.env.NO_FAST_ENABLE === 'true',
        flavor: Silian_config.flavor,
      })) as unknown
      if (Array.isArray(Silian_res)) {
        ;[Silian_err, Silian_ack] = Silian_res as unknown[]
      }
    } catch (Silian_e) {
      throw new Error('节点注册超时', {cause: Silian_e})
    }

    if (Silian_err) {
      if (typeof Silian_err === 'object' && 'message' in Silian_err) {
        throw new Error(Silian_err.message as string)
      }
    }
    if (Silian_ack !== true) {
      throw new Error('节点注册失败')
    }

    Silian_logger.info(Silian_colors.rainbow('start doing my job'))
    this.keepalive.start(this.socket)
  }

  private onConnectionError(Silian_event: string, Silian_err: Error): void {
    Silian_logger.error(`${Silian_event}: cannot connect to server`, Silian_err)
    if (this.server) {
      this.server.close(() => {
        this.exit(1)
      })
    } else {
      this.exit(1)
    }
  }
}
