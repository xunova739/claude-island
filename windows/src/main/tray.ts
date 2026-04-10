import { app, Tray, Menu, BrowserWindow, nativeImage } from 'electron'
import * as zlib from 'zlib'

type TrayStatus = 'idle' | 'processing' | 'waitingForApproval'

let trayInstance: Tray | null = null

// ── PNG icon generator ─────────────────────────────────────────────────────

function crc32(buf: Buffer): number {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1
    }
    table[i] = c
  }
  let crc = 0xffffffff
  for (const byte of buf) {
    crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff]
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii')
  const lengthBuf = Buffer.allocUnsafe(4)
  lengthBuf.writeUInt32BE(data.length, 0)
  const crcBuf = Buffer.allocUnsafe(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0)
  return Buffer.concat([lengthBuf, typeBytes, data, crcBuf])
}

function createCirclePng(r: number, g: number, b: number): Buffer {
  const size = 16
  const rows: Buffer[] = []
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4) // filter byte + RGBA pixels
    row[0] = 0 // None filter
    for (let x = 0; x < size; x++) {
      const dist = Math.sqrt((x - 7.5) ** 2 + (y - 7.5) ** 2)
      const alpha = dist <= 6.5 ? 255 : 0
      const off = 1 + x * 4
      row[off] = r
      row[off + 1] = g
      row[off + 2] = b
      row[off + 3] = alpha
    }
    rows.push(row)
  }

  const rawData = Buffer.concat(rows)
  const compressed = zlib.deflateSync(rawData)

  const ihdrData = Buffer.alloc(13)
  ihdrData.writeUInt32BE(size, 0)
  ihdrData.writeUInt32BE(size, 4)
  ihdrData[8] = 8  // bit depth
  ihdrData[9] = 6  // color type: RGBA
  // bytes 10–12 remain 0 (compression, filter, interlace)

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdrData),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

// Pre-built icons: gray=idle, orange=processing, yellow=waitingForApproval
const icons: Record<TrayStatus, Electron.NativeImage> = {
  idle: nativeImage.createFromBuffer(createCirclePng(128, 128, 128)),
  processing: nativeImage.createFromBuffer(createCirclePng(255, 145, 0)),
  waitingForApproval: nativeImage.createFromBuffer(createCirclePng(250, 204, 21))
}

// ── Tray lifecycle ─────────────────────────────────────────────────────────

export function createTray(win: BrowserWindow): void {
  trayInstance = new Tray(icons.idle)
  trayInstance.setToolTip('Claude Island')

  // Left-click: toggle HUD visibility
  trayInstance.on('click', () => {
    if (win.isVisible()) {
      win.hide()
    } else {
      win.show()
    }
  })

  updateContextMenu(win)

  // Rebuild context menu when window visibility changes so label stays accurate
  win.on('show', () => updateContextMenu(win))
  win.on('hide', () => updateContextMenu(win))

  app.on('before-quit', () => {
    if (trayInstance) {
      trayInstance.destroy()
      trayInstance = null
    }
  })
}

function updateContextMenu(win: BrowserWindow): void {
  if (!trayInstance) return
  const label = win.isVisible() ? '隐藏 HUD' : '显示 HUD'
  const menu = Menu.buildFromTemplate([
    {
      label,
      click: () => {
        if (win.isVisible()) {
          win.hide()
        } else {
          win.show()
        }
        updateContextMenu(win)
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => app.quit()
    }
  ])
  trayInstance.setContextMenu(menu)
}

// ── Status update (called by sessionManager) ───────────────────────────────

export function updateTrayIcon(status: TrayStatus): void {
  if (!trayInstance) return
  trayInstance.setImage(icons[status])
}
