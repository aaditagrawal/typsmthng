import { expose } from 'baseline-comlink'
import { serveWorkerRpc } from '../src/lib/worker-rpc'

const api = {
  echo: async (value: unknown) => value,
  fail: async () => { throw new TypeError('fixture failure') },
  wait: async () => new Promise(() => {}),
}
self.addEventListener('message', function setup({ data }) {
  if (data.kind !== 'setup') return
  self.removeEventListener('message', setup)
  if (data.baseline) expose(api)
  else serveWorkerRpc(api, self)
})
