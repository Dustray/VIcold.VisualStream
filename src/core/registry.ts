import type { ComputeModelPlugin, TraceFileParser } from './types'

export class PluginRegistry<Plugin extends { readonly id: string }> {
  private readonly plugins = new Map<string, Plugin>()

  register(plugin: Plugin): this {
    if (this.plugins.has(plugin.id)) throw new Error(`重复注册插件：${plugin.id}`)
    this.plugins.set(plugin.id, plugin)
    return this
  }

  get(id: string): Plugin {
    const plugin = this.plugins.get(id)
    if (!plugin) throw new Error(`当前版本未安装插件：${id}`)
    return plugin
  }

  values(): Plugin[] { return [...this.plugins.values()] }
}

export class ParserRegistry extends PluginRegistry<TraceFileParser> {
  async detect(file: File): Promise<TraceFileParser> {
    for (const parser of this.values()) if (await parser.probe(file)) return parser
    throw new Error('无法识别源格式。当前支持 Perfetto Protobuf、JSON trace 及其 gzip 压缩文件。')
  }
}

export class ComputeModelRegistry extends PluginRegistry<ComputeModelPlugin> {}
