import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'

const workspaceDirectory = resolve('.')
const legacySamples = resolve('public/samples')
const retiredSamples = resolve('.local', `retired-samples-${Date.now()}`)
if (!legacySamples.startsWith(workspaceDirectory + sep) || !retiredSamples.startsWith(workspaceDirectory + sep)) throw new Error('Sample asset paths must stay inside the workspace')
try {
  await stat(legacySamples)
  await mkdir(resolve('.local'), { recursive: true })
  await rename(legacySamples, retiredSamples)
  console.log('Retired legacy sample assets.')
} catch (error) { if (error.code !== 'ENOENT') throw error }

const directory = resolve('public/vendor/perfetto')
await mkdir(directory, { recursive: true })
const manifestPath = resolve(directory, 'manifest.json')
let manifest
try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')) } catch {}
if (!manifest || process.argv.includes('--refresh')) {
  let version = 'v59.1-79997ada9'
  if (process.argv.includes('--refresh')) {
  const response = await fetch('https://ui.perfetto.dev/', { signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`Perfetto index: HTTP ${response.status}`)
  const html = await response.text()
  const channels = html.match(/data-perfetto_version='([^']+)'/)?.[1]
  version = channels ? JSON.parse(channels).stable : html.match(/(v\d+(?:\.\d+){1,2}-[a-f0-9]{7,})/g)?.[0]
  if (!version) {
    await writeFile(resolve(directory, 'index-debug.html'), html)
    const references = [...html.matchAll(/(?:src|href)=["']([^"']+)/g)].map(match => match[1])
    throw new Error(`Unable to identify the official Perfetto release directory. Assets: ${references.join(', ')}`)
  }
  }
  const base = `https://ui.perfetto.dev/${version}`
  const files = {}
  for (const name of ['engine_bundle.js', 'trace_processor.wasm']) {
    console.log(`Downloading ${version}/${name}`)
    const asset = await fetch(`${base}/${name}`, { signal: AbortSignal.timeout(120000) })
    if (!asset.ok) throw new Error(`${name}: HTTP ${asset.status}`)
    const bytes = new Uint8Array(await asset.arrayBuffer())
    await writeFile(resolve(directory, name), bytes)
    files[name] = { bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') }
  }
  const revision = version.split('-').at(-1)
  const license = await fetch(`https://raw.githubusercontent.com/google/perfetto/${revision}/LICENSE`)
  if (!license.ok) throw new Error(`Perfetto license: HTTP ${license.status}`)
  await writeFile(resolve(directory, 'LICENSE'), await license.text())
  manifest = { version, base, files, downloadedAt: new Date().toISOString() }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2))
}
console.log(`Perfetto pinned: ${manifest.version}`)

for (const [name, expected] of Object.entries(manifest.files)) {
  let valid = false
  try { valid = createHash('sha256').update(await readFile(resolve(directory, name))).digest('hex') === expected.sha256 } catch {}
  if (valid) continue
  console.log(`Restoring ${manifest.version}/${name}`)
  const response = await fetch(`${manifest.base}/${name}`, { signal: AbortSignal.timeout(120000) })
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (createHash('sha256').update(bytes).digest('hex') !== expected.sha256) throw new Error(`${name}: checksum mismatch`)
  await writeFile(resolve(directory, name), bytes)
}

if (!manifest.files['trace_processor_memory64.wasm']) {
  const name = 'trace_processor_memory64.wasm'
  console.log(`Downloading ${manifest.version}/${name}`)
  const response = await fetch(`${manifest.base}/${name}`, { signal: AbortSignal.timeout(120000) })
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  await writeFile(resolve(directory, name), bytes)
  manifest.files[name] = { bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2))
}
