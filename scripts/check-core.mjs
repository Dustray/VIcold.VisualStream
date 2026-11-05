import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const directory = resolve('node_modules/typescript-native')
const metadata = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'))
const binary = resolve(directory, typeof metadata.bin === 'string' ? metadata.bin : metadata.bin.tsc)
const javascript = /\.[cm]?js$/.test(binary) || readFileSync(binary, 'utf8').startsWith('#!/usr/bin/env node')
const child = spawn(javascript ? process.execPath : binary, [...(javascript ? [binary] : []), '-p', process.argv[2] ?? 'tsconfig.core.json', '--noEmit'], { stdio: 'inherit' })
child.on('error', (error) => { console.error(error.message); process.exitCode = 1 })
child.on('exit', (code) => { process.exitCode = code ?? 1 })
