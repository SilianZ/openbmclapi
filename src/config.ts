import Silian_dotenv from 'dotenv'
import {z as Silian_z} from 'zod'
import Silian_env from 'env-var'

export interface IConfigFlavor {
  runtime: string
  storage: string
}

export class Config {
  public static instance: Config

  public readonly clusterId = Silian_env.get('CLUSTER_ID').required().asString()
  public readonly clusterSecret = Silian_env.get('CLUSTER_SECRET').required().asString()
  public readonly clusterIp? = Silian_env.get('CLUSTER_IP').asString()
  public readonly port: number = Silian_env.get('CLUSTER_PORT').default(4000).asPortNumber()
  public readonly clusterPublicPort = Silian_env.get('CLUSTER_PUBLIC_PORT').default(this.port).asPortNumber()
  public readonly byoc = Silian_env.get('CLUSTER_BYOC').asBool()
  public readonly disableAccessLog = Silian_env.get('DISABLE_ACCESS_LOG').asBool()

  public readonly enableNginx = Silian_env.get('ENABLE_NGINX').asBool()
  public readonly enableUpnp = Silian_env.get('ENABLE_UPNP').asBool()
  public readonly storage = Silian_env.get('CLUSTER_STORAGE').default('file').asString()
  public readonly storageOpts = Silian_env.get('CLUSTER_STORAGE_OPTIONS').asJsonObject()

  public readonly sslKey = Silian_env.get('SSL_KEY').asString()
  public readonly sslCert = Silian_env.get('SSL_CERT').asString()

  public readonly flavor: IConfigFlavor

  private constructor() {
    this.flavor = {
      runtime: `Node.js/${process.version}`,
      storage: this.storage,
    }
  }

  public static getInstance(): Config {
    if (!Config.instance) {
      Config.instance = new Config()
    }
    return Config.instance
  }
}

export const OpenbmclapiAgentConfigurationSchema = Silian_z.object({
  sync: Silian_z.object({
    source: Silian_z.string(),
    concurrency: Silian_z.number(),
  }),
})

export type OpenbmclapiAgentConfiguration = Silian_z.infer<typeof OpenbmclapiAgentConfigurationSchema>

Silian_dotenv.config()

export const config = Config.getInstance()
