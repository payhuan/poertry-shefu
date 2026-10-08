import { Converter as toTraditionalConverter } from 'opencc-js/cn2t'
import { Converter as toSimplifiedConverter } from 'opencc-js/t2cn'

export type Script = 'simplified' | 'traditional'

const toSimplified = toSimplifiedConverter({ from: 't', to: 'cn' })
const toTraditional = toTraditionalConverter({ from: 'cn', to: 't' })

export function convertScript(text: string, script: Script): string {
  return script === 'traditional' ? toTraditional(text) : toSimplified(text)
}

const STORAGE_KEY = 'poetry-shefu-script-v1'

export function readScript(): Script {
  try { return localStorage.getItem(STORAGE_KEY) === 'traditional' ? 'traditional' : 'simplified' }
  catch { return 'simplified' }
}

export function saveScript(script: Script): void {
  try { localStorage.setItem(STORAGE_KEY, script) } catch { /* Display still works without storage. */ }
}
