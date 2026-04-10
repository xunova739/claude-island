interface Window {
  electron: {
    ipcRenderer: {
      on: (channel: string, listener: (...args: unknown[]) => void) => void
      send: (channel: string, ...args: unknown[]) => void
      removeAllListeners: (channel: string) => void
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
    }
  }
}
