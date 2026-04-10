import { app } from 'electron'
import https from 'https'
import { createWriteStream } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { spawn } from 'child_process'

const RELEASES_API_URL =
  'https://api.github.com/repos/xunova739/claude-island-windows/releases/tags/latest-build'

export interface UpdateInfo {
  version: string
  downloadUrl: string
  publishedAt: string
  size: number
}

function httpsGetText(
  url: string,
  headers: Record<string, string>
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers }, (res) => {
        let body = ''
        res.on('data', (chunk: Buffer) => {
          body += chunk.toString()
        })
        res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, body }))
      })
      .on('error', reject)
  })
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    const { statusCode, body } = await httpsGetText(RELEASES_API_URL, {
      'User-Agent': 'claude-island-windows-updater',
      Accept: 'application/vnd.github.v3+json'
    })
    if (statusCode !== 200) return null

    const release = JSON.parse(body) as {
      name?: string
      tag_name: string
      assets: Array<{ name: string; browser_download_url: string; size: number }>
      published_at: string
    }

    const exeAsset = release.assets.find((a) => a.name.endsWith('.exe'))
    if (!exeAsset) return null

    return {
      version: release.name ?? release.tag_name,
      downloadUrl: exeAsset.browser_download_url,
      publishedAt: release.published_at,
      size: exeAsset.size
    }
  } catch {
    return null
  }
}

function downloadFile(
  url: string,
  destPath: string,
  onProgress: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const follow = (currentUrl: string) => {
      https
        .get(
          currentUrl,
          { headers: { 'User-Agent': 'claude-island-windows-updater' } },
          (res) => {
            if (
              (res.statusCode === 301 || res.statusCode === 302) &&
              typeof res.headers.location === 'string'
            ) {
              follow(res.headers.location)
              return
            }
            if (res.statusCode !== 200) {
              reject(new Error(`HTTP ${res.statusCode ?? 'unknown'}`))
              return
            }
            const total = parseInt(res.headers['content-length'] ?? '0', 10)
            let downloaded = 0
            const fileStream = createWriteStream(destPath)
            res.on('data', (chunk: Buffer) => {
              downloaded += chunk.length
              if (total > 0) {
                onProgress(Math.min(99, Math.floor((downloaded / total) * 100)))
              }
            })
            res.pipe(fileStream)
            fileStream.on('finish', () => {
              fileStream.close()
              onProgress(100)
              resolve()
            })
            fileStream.on('error', reject)
            res.on('error', reject)
          }
        )
        .on('error', reject)
    }
    follow(url)
  })
}

export async function downloadUpdate(
  url: string,
  onProgress: (percent: number) => void
): Promise<string> {
  const destPath = join(tmpdir(), 'claude-island-windows-update.exe')
  await downloadFile(url, destPath, onProgress)
  return destPath
}

export function installAndRelaunch(installerPath: string): void {
  if (process.platform === 'win32') {
    const child = spawn(installerPath, ['/S'], {
      detached: true,
      stdio: 'ignore',
      shell: false
    })
    child.unref()
  }
  app.quit()
}
