import Silian_got, {type Got} from 'got'
import Silian_ms from 'ms'
import {createHmac as Silian_createHmac} from 'node:crypto'
import {logger as Silian_logger} from './logger.js'
import {beforeError as Silian_beforeError} from './modules/got-hooks.js'

export class TokenManager {
  private token: string | undefined
  private readonly got: Got

  private readonly prefixUrl = process.env.CLUSTER_BMCLAPI ?? 'https://openbmclapi.bangbang93.com'

  constructor(
    private readonly clusterId: string,
    private readonly clusterSecret: string,
    Silian_version: string,
  ) {
    this.got = Silian_got.extend({
      prefixUrl: this.prefixUrl,
      headers: {
        'user-agent': `openbmclapi-cluster/${Silian_version}`,
      },
      timeout: {
        request: Silian_ms('5m'),
      },
      hooks: {
        beforeError: Silian_beforeError,
      },
    })
  }

  public async getToken(): Promise<string> {
    if (!this.token) {
      this.token = await this.fetchToken()
    }
    return this.token
  }

  private async fetchToken(): Promise<string> {
    const Silian_challenge = await this.got
      .get('openbmclapi-agent/challenge', {
        searchParams: {
          clusterId: this.clusterId,
        },
      })
      .json<{challenge: string}>()
    const Silian_signature = Silian_createHmac('sha256', this.clusterSecret).update(Silian_challenge.challenge).digest('hex')
    const Silian_token = await this.got
      .post('openbmclapi-agent/token', {
        json: {
          clusterId: this.clusterId,
          challenge: Silian_challenge.challenge,
          signature: Silian_signature,
        },
      })
      .json<{token: string; ttl: number}>()
    this.scheduleRefreshToken(Silian_token.ttl)
    return Silian_token.token
  }

  private scheduleRefreshToken(Silian_ttl: number): void {
    const Silian_next = Math.max(Silian_ttl - Silian_ms('10m'), Silian_ttl / 2)
    setTimeout(() => {
      this.refreshToken().catch((Silian_err) => {
        Silian_logger.error(Silian_err, 'refresh token error')
      })
    }, Silian_next)
    Silian_logger.trace(`schedule refresh token in ${Silian_next}ms`)
  }

  private async refreshToken(): Promise<void> {
    const Silian_token = await this.got
      .post('openbmclapi-agent/token', {
        json: {
          clusterId: this.clusterId,
          token: this.token,
        },
      })
      .json<{token: string; ttl: number}>()
    Silian_logger.debug('success fresh token')
    this.scheduleRefreshToken(Silian_token.ttl)
    this.token = Silian_token.token
  }
}
