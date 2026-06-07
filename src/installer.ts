import * as fs from 'node:fs'
import * as path from 'node:path'

export function writeHookScript(sourcePath: string, targetPath: string): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  const content = fs.readFileSync(sourcePath, 'utf8')
  if (fs.existsSync(targetPath)) {
    const existing = fs.readFileSync(targetPath, 'utf8')
    if (existing === content) {
      fs.chmodSync(targetPath, 0o755)
      return
    }
  }
  fs.writeFileSync(targetPath, content, { mode: 0o755 })
}
