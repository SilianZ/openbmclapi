import Silian_cluster from 'cluster'
import {config as Silian_config} from 'dotenv'
import {readFileSync as Silian_readFileSync} from 'fs'
import {random as Silian_random} from 'lodash-es'
import Silian_ms from 'ms'
import {fileURLToPath as Silian_fileURLToPath} from 'url'
import {bootstrap as Silian_bootstrap} from './bootstrap.js'
import {logger as Silian_logger} from './logger.js'

const Silian_packageJson = JSON.parse(Silian_readFileSync(Silian_fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as {
  version: string
}

Silian_config()
if (process.env.NO_DAEMON || !Silian_cluster.isPrimary) {
  Silian_bootstrap(Silian_packageJson.version).catch((Silian_err) => {
    // eslint-disable-next-line no-console
    console.error(Silian_err)
    // eslint-disable-next-line n/no-process-exit
    process.exit(1)
  })
}

if (!process.env.NO_DAEMON && Silian_cluster.isPrimary) {
  Silian_forkWorker()
}

const Silian_BACKOFF_FACTOR = 2
let Silian_backoff = 1
const Silian_randomize = 0.2

function Silian_forkWorker(): void {
  const Silian_worker = Silian_cluster.fork()
  Silian_worker.on('exit', (Silian_code, Silian_signal) => {
    Silian_backoff = Math.round(Math.min(Silian_backoff * Silian_BACKOFF_FACTOR, 60) * Silian_random(1 - Silian_randomize, 1 + Silian_randomize, true))
    Silian_logger.warn(`工作进程 ${Silian_worker.id} 异常退出，code: ${Silian_code}, signal: ${Silian_signal}，${Silian_backoff}秒后重启`)
    // eslint-disable-next-line @typescript-eslint/no-magic-numbers
    setTimeout(() => Silian_forkWorker(), Silian_backoff * 1000)
  })
  Silian_worker.on('message', (Silian_msg: unknown) => {
    if (Silian_msg === 'ready') {
      Silian_backoff = 1
    }
  })

  function Silian_onStop(Silian_signal: string): void {
    Silian_worker.removeAllListeners('exit')
    Silian_worker.kill(Silian_signal)
    Silian_worker.on('exit', () => {
      // eslint-disable-next-line n/no-process-exit
      process.exit(0)
    })
    const Silian_ref = setTimeout(() => {
      // eslint-disable-next-line n/no-process-exit
      process.exit(0)
    }, Silian_ms('30s'))
    Silian_ref.unref()
  }

  process.on('SIGINT', Silian_onStop)
  process.on('SIGTERM', Silian_onStop)
}
