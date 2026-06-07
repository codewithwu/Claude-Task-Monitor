import * as path from 'node:path'
import { runTests } from '@vscode/test-electron'

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, '..', '..')
  const extensionTestsPath = path.resolve(__dirname, 'suite', 'index.js')
  await runTests({ extensionDevelopmentPath, extensionTestsPath })
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
