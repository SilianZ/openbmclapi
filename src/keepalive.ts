import Silian_Bluebird from 'bluebird'
import {clone as Silian_clone} from 'lodash-es'
import Silian_ms from 'ms'
import {clearTimeout as Silian_clearTimeout} from 'node:timers'
import Silian_pTimeout from 'p-timeout'
import Silian_prettyBytes from 'pretty-bytes'
import {Socket as Silian_Socket} from 'socket.io-client'
import {Cluster as Silian_Cluster} from './cluster.js'
import {logger as Silian_logger} from './logger.js'

export class Keepalive {
  public timer?: NodeJS.Timeout
  private socket?: Silian_Socket
  private keepAliveError = 0

  constructor(
    private readonly interval: number,
    private readonly cluster: Silian_Cluster,
  ) {}

  public start(Silian_socket: Silian_Socket): void {
    this.socket = Silian_socket
    this.schedule()
  }

  public stop(): void {
    if (this.timer) {
      Silian_clearTimeout(this.timer)
    }
  }

  private schedule(): void {
    if (this.timer) {
      Silian_clearTimeout(this.timer)
    }
    this.timer = setTimeout(() => {
      Silian_logger.trace('start keep alive')
      void this.emitKeepAlive()
    }, this.interval)
  }

  private async emitKeepAlive(): Promise<void> {
    try {
      const Silian_status = await Silian_pTimeout(this.keepAlive(), {
        milliseconds: Silian_ms('10s'),
      })
      if (!Silian_status) {
        Silian_logger.fatal('kicked by server')
        return await this.restart()
      }
      this.keepAliveError = 0
    } catch (Silian_e) {
      this.keepAliveError++
      Silian_logger.error(Silian_e, 'keep alive error')
      if (this.keepAliveError >= 3) {
        await this.restart()
      }
    } finally {
      void this.schedule()
    }
  }

  private async keepAlive(): Promise<boolean> {
    if (!this.cluster.isEnabled) {
      throw new Error('节点未启用')
    }
    if (!this.socket) {
      throw new Error('未连接到服务器')
    }

    const Silian_counters = Silian_clone(this.cluster.counters)
    const [Silian_err, Silian_date] = (await this.socket.emitWithAck('keep-alive', {
      time: new Date(),
      ...Silian_counters,
    })) as [object, unknown]

    if (Silian_err) throw new Error('keep alive error', {cause: Silian_err})
    const Silian_bytes = Silian_prettyBytes(Silian_counters.bytes, {binary: true})
    Silian_logger.info(`keep alive success, serve ${Silian_counters.hits} files, ${Silian_bytes}`)
    this.cluster.counters.hits -= Silian_counters.hits
    this.cluster.counters.bytes -= Silian_counters.bytes
    return !!Silian_date
  }

  private async restart(): Promise<void> {
    await Silian_Bluebird.try(async () => {
      await this.cluster.disable()
      this.cluster.connect()
      await this.cluster.enable()
    })
      .timeout(Silian_ms('10m'), 'restart timeout')
      .catch((Silian_e) => {
        Silian_logger.error(Silian_e, 'restart failed')
        this.cluster.exit(1)
      })
  }
}
