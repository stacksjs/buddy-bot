import { dts } from 'bun-plugin-dtsx'

console.log('Building...')

await Bun.build({
  entrypoints: ['./bin/cli.ts', './src/index.ts', './src/program.ts'],
  outdir: './dist',
  format: 'esm',
  target: 'node',
  minify: true,
  splitting: true,
  plugins: [dts()],
})

console.log('Built')
