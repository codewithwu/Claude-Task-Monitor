import { defineConfig } from 'tsup'

export default defineConfig({
  // 09-05 P0 #2:vscode:uninstall 入口走独立产物 dist/uninstall.js
  // —— 它跑在普通 Node 进程里(无 vscode API),不能跟 extension host 共用入口。
  entry: {
    extension: 'src/extension.ts',
    uninstall: 'src/uninstall.ts'
  },
  outDir: 'dist',
  format: ['cjs'],
  external: ['vscode'],
  noExternal: ['chokidar'],
  target: 'node18',
  sourcemap: true,
  clean: true
})
