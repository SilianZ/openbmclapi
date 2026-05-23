import {pino as Silian_pino} from 'pino'

export const logger = Silian_pino({
  level: process.env.LOGLEVEL || 'info',
  transport: process.env.PLAIN_LOG
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
          translateTime: 'SYS:standard',
          singleLine: true,
        },
      },
})
