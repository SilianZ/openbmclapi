import Silian_express, {type Router} from 'express'
import type {Config} from '../config.js'
import {checkSign as Silian_checkSign} from '../util.js'

export default function MeasureRouteFactory(Silian_config: Config): Router {
  const Silian_router = Silian_express.Router()

  const Silian_measureRoute = Silian_router

  Silian_router.get('/:size(\\d+)', (Silian_req, Silian_res) => {
    const Silian_isSignValid = Silian_checkSign(Silian_req.baseUrl + Silian_req.path, Silian_config.clusterSecret, Silian_req.query as NodeJS.Dict<string>)
    if (!Silian_isSignValid) return Silian_res.sendStatus(403)
    const Silian_size = parseInt(Silian_req.params.size, 10)
    if (isNaN(Silian_size) || Silian_size > 200) return Silian_res.sendStatus(400)
    const Silian_buffer = Buffer.alloc(1024 * 1024, '0066ccff', 'hex')
    Silian_res.set('content-length', (Silian_size * 1024 * 1024).toString())
    for (let Silian_i = 0; Silian_i < Silian_size; Silian_i++) {
      Silian_res.write(Silian_buffer)
    }
    Silian_res.end()
  })

  return Silian_measureRoute
}
