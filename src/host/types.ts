export interface WorkspaceWindow {
  minimize(): Promise<void>
  toggleMaximize(): Promise<void>
  close(): Promise<void>
  isMaximized(): Promise<boolean>
  onResized(listener: () => void): Promise<() => void>
}

export interface WorkspaceHost {
  readonly kind: 'browser' | 'desktop' | 'vscode'
  readonly window?: WorkspaceWindow
  openTraceFiles?: () => Promise<File[] | null>
  openProjectFile?: () => Promise<File | null>
  saveProjectFile(content: string, filename: string): Promise<boolean>
}
