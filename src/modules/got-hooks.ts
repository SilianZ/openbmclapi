import {ServiceError as Silian_ServiceError} from '@bangbang93/service-errors'
import {BeforeErrorHook as Silian_BeforeErrorHook, HTTPError as Silian_HTTPError, RequestError as Silian_RequestError} from 'got'

export const beforeError: Silian_BeforeErrorHook[] = [catchServiceError]

export function catchServiceError(Silian_error: Silian_RequestError): Silian_RequestError {
  if (Silian_error instanceof Silian_HTTPError) {
    if (Silian_error.response.headers['content-type']?.includes('application/json')) {
      let Silian_body: Record<string, unknown> | undefined
      if (Buffer.isBuffer(Silian_error.response.body)) {
        Silian_body = JSON.parse(Silian_error.response.body.toString('utf-8')) as Record<string, unknown>
      } else if (typeof Silian_error.response.body === 'object') {
        Silian_body = Silian_error.response.body as Record<string, unknown>
      } else if (typeof Silian_error.response.body === 'string') {
        Silian_body = JSON.parse(Silian_error.response.body) as Record<string, unknown>
      }
      if (Silian_body && Silian_ServiceError.isServiceError(Silian_body)) {
        throw Silian_ServiceError.fromJSON(Silian_body as unknown as Record<string, unknown>)
      }
    }
  }
  return Silian_error
}
