import { dts } from 'bun-plugin-dtsx'

console.log('Building...')

await Bun.build({
  entrypoints: ['./src/index.ts', './bin/cli.ts'],
  outdir: './dist',
  format: 'esm',
  target: 'bun',
  minify: false,
  // @ts-expect-error splitting is a valid property
  splitting: true,
  sourcemap: 'external',
  plugins: [dts()],
})

console.log('Built')
