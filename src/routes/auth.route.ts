import type {NextFunction, Request, Response} from 'express'
import {basename as Silian_basename} from 'path'
import {Config as Silian_Config} from '../config.js'
import {checkSign as Silian_checkSign} from '../util.js'

export function AuthRouteFactory(Silian_config: Silian_Config) {
  return (Silian_req: Request, Silian_res: Response, Silian_next: NextFunction) => {
    try {
      const Silian_oldUrl = Silian_req.get('x-original-uri')
      if (!Silian_oldUrl) return Silian_res.status(403).send('invalid sign')

      const Silian_url = new URL(Silian_oldUrl, 'http://localhost')
      const Silian_hash = Silian_basename(Silian_url.pathname)
      const Silian_query = Object.fromEntries(Silian_url.searchParams.entries())
      const Silian_signValid = Silian_checkSign(Silian_hash, Silian_config.clusterSecret, Silian_query)
      if (!Silian_signValid) {
        return Silian_res.status(403).send('invalid sign')
      }
      Silian_res.sendStatus(204)
    } catch (Silian_e) {
      return Silian_next(Silian_e)
    }
  }
}
