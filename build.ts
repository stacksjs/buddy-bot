import { dts } from 'bun-plugin-dtsx'

console.log('Building...')

await Bun.build({
  entrypoints: ['./src/index.ts', './bin/cli.ts'],
  outdir: './dist',
  format: 'esm',
  target: 'bun',
  minify: false,
  splitting: false,
  sourcemap: 'external',
  plugins: [dts()],
})

console.log('Built')
