export interface ParsedCommand {
  name: string
  args: string[]
  flags: Record<string, string | boolean>
  raw: string
}

export class CommandSyntaxError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CommandSyntaxError'
  }
}

export function tokenize(input: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | undefined
  let escaping = false
  let hasContent = false

  const push = (): void => {
    if (!hasContent) return
    tokens.push(current)
    current = ''
    hasContent = false
  }

  for (const character of input.trim()) {
    if (escaping) {
      current += character
      hasContent = true
      escaping = false
      continue
    }
    if (character === '\\') {
      escaping = true
      hasContent = true
      continue
    }
    if (quote) {
      if (character === quote) quote = undefined
      else current += character
      hasContent = true
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      hasContent = true
      continue
    }
    if (/\s/u.test(character)) {
      push()
      continue
    }
    current += character
    hasContent = true
  }

  if (escaping) throw new CommandSyntaxError('A trailing backslash must escape another character')
  if (quote) throw new CommandSyntaxError(`Missing closing ${quote}`)
  push()
  return tokens
}

export function parseCommand(input: string): ParsedCommand {
  if (input.length > 1_000) throw new CommandSyntaxError('Command is too long (maximum 1000 characters)')
  if (/\p{Cc}/u.test(input.replace(/[\t\n\r]/gu, ''))) throw new CommandSyntaxError('Command contains control characters')
  const tokens = tokenize(input)
  const name = tokens.shift()?.toLowerCase()
  if (!name) throw new CommandSyntaxError('Enter a command. Try help.')
  if (!/^[a-z][a-z0-9_-]*$/u.test(name)) throw new CommandSyntaxError(`Invalid command name: ${name}`)

  const args: string[] = []
  const flags: Record<string, string | boolean> = {}
  let parseFlags = true
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token === undefined) continue
    if (parseFlags && token === '--') {
      parseFlags = false
      continue
    }
    if (parseFlags && token.startsWith('--')) {
      const equalsAt = token.indexOf('=')
      const key = token.slice(2, equalsAt < 0 ? undefined : equalsAt).toLowerCase()
      if (!/^[a-z][a-z0-9-]*$/u.test(key)) throw new CommandSyntaxError(`Invalid flag: ${token}`)
      if (key in flags) throw new CommandSyntaxError(`Flag --${key} was provided more than once`)
      if (equalsAt >= 0) {
        const value = token.slice(equalsAt + 1)
        if (!value) throw new CommandSyntaxError(`Flag --${key} needs a value`)
        flags[key] = value
      } else {
        const next = tokens[index + 1]
        if (next !== undefined && !next.startsWith('--')) {
          flags[key] = next
          index += 1
        } else {
          flags[key] = true
        }
      }
    } else {
      args.push(token)
    }
  }
  return { name, args, flags, raw: input }
}

export function resourceName(value: string): string {
  const normalized = value.toLowerCase().replace(/^minecraft:/u, '')
  if (!/^[a-z0-9_]+$/u.test(normalized)) throw new CommandSyntaxError(`Invalid Minecraft identifier: ${value}`)
  return normalized
}

export function boundedInteger(value: string | undefined, label: string, minimum: number, maximum: number): number {
  if (value === undefined || !/^-?\d+$/u.test(value)) {
    throw new CommandSyntaxError(`${label} must be a whole number from ${minimum} to ${maximum}`)
  }
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new CommandSyntaxError(`${label} must be a whole number from ${minimum} to ${maximum}`)
  }
  return number
}

export function boundedNumber(value: string | undefined, label: string, minimum: number, maximum: number): number {
  if (value === undefined || value.trim() === '') throw new CommandSyntaxError(`${label} is required`)
  const number = Number(value)
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new CommandSyntaxError(`${label} must be a number from ${minimum} to ${maximum}`)
  }
  return number
}

export function flagInteger(
  command: ParsedCommand,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const value = command.flags[name]
  if (value === undefined) return boundedInteger(String(fallback), `default --${name}`, minimum, maximum)
  if (typeof value !== 'string') throw new CommandSyntaxError(`Flag --${name} needs a number`)
  return boundedInteger(value, `--${name}`, minimum, maximum)
}

export function flagBoolean(command: ParsedCommand, name: string, fallback = false): boolean {
  const value = command.flags[name]
  if (value === undefined) return fallback
  if (value === true) return true
  if (value === 'true' || value === 'yes' || value === '1') return true
  if (value === 'false' || value === 'no' || value === '0') return false
  throw new CommandSyntaxError(`Flag --${name} must be true or false`)
}

export function assertOnlyFlags(command: ParsedCommand, allowed: string[]): void {
  const allowedSet = new Set(allowed)
  const unknown = Object.keys(command.flags).find((name) => !allowedSet.has(name))
  if (unknown) throw new CommandSyntaxError(`Unknown flag --${unknown}`)
}
