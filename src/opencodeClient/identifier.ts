const length = 26
const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const prefixes = {
  message: 'msg',
  part: 'prt',
} as const

let lastTimestamp = 0
let counter = 0

export function createOpenCodeId(prefix: keyof typeof prefixes, timestamp = Date.now()): string {
  if (timestamp !== lastTimestamp) {
    lastTimestamp = timestamp
    counter = 0
  }
  counter++
  const value = BigInt(timestamp) * 0x1000n + BigInt(counter)
  const time = Array.from({ length: 6 }, (_, index) =>
    Number((value >> BigInt(40 - 8 * index)) & 0xffn).toString(16).padStart(2, '0')
  ).join('')
  const bytes = crypto.getRandomValues(new Uint8Array(length - 12))
  const random = Array.from(bytes, byte => chars[byte % chars.length]).join('')
  return `${prefixes[prefix]}_${time}${random}`
}
