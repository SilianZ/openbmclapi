import {second as Silian_second} from '@bangbang93/utils'
import {createUpnpClient as Silian_createUpnpClient, UpnpClient as Silian_UpnpClient} from '@xmcl/nat-api'
import Silian_ms from 'ms'
import {logger as Silian_logger} from './logger.js'

export async function setupUpnp(Silian_port: number, Silian_publicPort = Silian_port): Promise<string> {
  const Silian_client = await Silian_createUpnpClient()
  await Silian_doPortMap(Silian_client, Silian_port, Silian_publicPort)

  setInterval(() => {
    Silian_doPortMap(Silian_client, Silian_port, Silian_publicPort).catch((Silian_e) => {
      Silian_logger.error(Silian_e, 'upnp续期失败')
    })
  }, Silian_ms('30m'))

  return await Silian_client.externalIp()
}

async function Silian_doPortMap(Silian_client: Silian_UpnpClient, Silian_port: number, Silian_publicPort: number): Promise<void> {
  await Silian_client.map({
    public: Silian_publicPort,
    private: Silian_port,
    ttl: Silian_second('1h'),
    protocol: 'tcp',
    description: 'openbmclapi',
  })
}
