// The server and App interpret the same data-only profile. No eval or code generation.
const annotations = new Set(['title', 'description', 'default', 'examples'])
const keywords = new Set([...annotations, 'type', 'properties', 'required', 'additionalProperties', 'items', 'minItems', 'maxItems', 'uniqueItems', 'enum', 'const', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'oneOf', 'anyOf', 'allOf', 'if', 'then', 'else'])
const types = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'])
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const dangerous = key => ['__proto__', 'prototype', 'constructor'].includes(key)
export function assertCreationSchema(schema) {
  let count = 0
  function visit(node, depth) {
    if (!object(node) || depth > 24 || ++count > 2000) throw new Error('参数合同过大或无效')
    for (const key of Object.keys(node)) if (!keywords.has(key)) throw new Error(`不支持的参数校验关键字：${key}`)
    if (node.type !== undefined && !types.has(node.type)) throw new Error('不支持的参数类型')
    if (node.properties !== undefined) {
      if (!object(node.properties)) throw new Error('properties 必须是对象')
      for (const [key, child] of Object.entries(node.properties)) {
        if (dangerous(key)) throw new Error('不安全的参数名')
        visit(child, depth + 1)
      }
    }
    if (node.required !== undefined && (!Array.isArray(node.required) || !node.required.every(key => typeof key === 'string' && !dangerous(key)))) throw new Error('required 无效')
    if (node.additionalProperties !== undefined && typeof node.additionalProperties !== 'boolean') throw new Error('additionalProperties 必须为布尔值')
    if (node.uniqueItems !== undefined && typeof node.uniqueItems !== 'boolean') throw new Error('uniqueItems 必须为布尔值')
    if (node.enum !== undefined && (!Array.isArray(node.enum) || !node.enum.length)) throw new Error('enum 无效')
    for (const key of ['minItems', 'maxItems', 'minLength', 'maxLength']) if (node[key] !== undefined && (!Number.isInteger(node[key]) || node[key] < 0)) throw new Error(`${key} 无效`)
    for (const key of ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf']) if (node[key] !== undefined && (!Number.isFinite(node[key]) || (key === 'multipleOf' && node[key] <= 0))) throw new Error(`${key} 无效`)
    for (const key of ['items', 'if', 'then', 'else']) if (node[key] !== undefined) visit(node[key], depth + 1)
    for (const key of ['oneOf', 'anyOf', 'allOf']) if (node[key] !== undefined) {
      if (!Array.isArray(node[key]) || !node[key].length) throw new Error(`${key} 无效`)
      node[key].forEach(child => visit(child, depth + 1))
    }
  }
  if (schema?.type !== 'object') throw new Error('参数合同根节点必须为 object')
  visit(schema, 0)
}
export function canonicalCreationJson(value, depth = 0) {
  if (depth > 64) throw new Error('JSON 参数嵌套过深')
  if (Array.isArray(value)) return '[' + value.map(item => canonicalCreationJson(item, depth + 1)).join(',') + ']'
  if (object(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalCreationJson(value[key], depth + 1)).join(',') + '}'
  const result = JSON.stringify(value)
  if (result === undefined) throw new Error('参数不是 JSON 数据')
  return result
}
export function validateCreationParams(schema, value) {
  assertCreationSchema(schema)
  function validate(node, data, path, depth) {
    if (depth > 48) return [`${path} 嵌套过深`]
    const errors = []
    const fail = message => errors.push(`${path} ${message}`)
    const matches = type => type === 'object' ? object(data) : type === 'array' ? Array.isArray(data) : type === 'null' ? data === null : type === 'integer' ? Number.isInteger(data) : type === 'number' ? typeof data === 'number' && Number.isFinite(data) : typeof data === type
    if (node.type && !matches(node.type)) return [`${path} 必须为 ${node.type}`]
    if ('const' in node && canonicalCreationJson(data) !== canonicalCreationJson(node.const)) fail('不符合固定值')
    if (node.enum && !node.enum.some(item => canonicalCreationJson(data) === canonicalCreationJson(item))) fail('不在允许值中')
    if (object(data)) {
      for (const key of node.required || []) if (!Object.hasOwn(data, key)) fail(`缺少 ${key}`)
      for (const [key, item] of Object.entries(data)) {
        if (dangerous(key)) { fail('包含不安全参数'); continue }
        if (Object.hasOwn(node.properties || {}, key)) errors.push(...validate(node.properties[key], item, `${path}.${key}`, depth + 1))
        else if (node.additionalProperties === false) fail(`不支持 ${key}`)
      }
    }
    if (Array.isArray(data)) {
      if (data.length < (node.minItems ?? 0) || data.length > (node.maxItems ?? Infinity)) fail('数量超出范围')
      if (node.uniqueItems && new Set(data.map(item => canonicalCreationJson(item))).size !== data.length) fail('不能有重复项')
      if (node.items) data.forEach((item, i) => errors.push(...validate(node.items, item, `${path}[${i}]`, depth + 1)))
    }
    if (typeof data === 'string' && ([...data].length < (node.minLength ?? 0) || [...data].length > (node.maxLength ?? Infinity))) fail('字符数超出范围')
    if (typeof data === 'number') {
      if (!Number.isFinite(data) || data < (node.minimum ?? -Infinity) || data > (node.maximum ?? Infinity) || data <= (node.exclusiveMinimum ?? -Infinity) || data >= (node.exclusiveMaximum ?? Infinity)) fail('数值超出范围')
      if (node.multipleOf && Math.abs(data / node.multipleOf - Math.round(data / node.multipleOf)) > 1e-8) fail('不符合步长')
    }
    for (const key of ['oneOf', 'anyOf', 'allOf']) if (node[key]) {
      const hits = node[key].filter(child => !validate(child, data, path, depth + 1).length).length
      if (key === 'oneOf' ? hits !== 1 : key === 'anyOf' ? hits === 0 : hits !== node[key].length) fail(`不符合 ${key}`)
    }
    if (node.if) {
      const branch = !validate(node.if, data, path, depth + 1).length ? node.then : node.else
      if (branch) errors.push(...validate(branch, data, path, depth + 1))
    }
    return errors.slice(0, 20)
  }
  return validate(schema, value, 'params', 0)
}
