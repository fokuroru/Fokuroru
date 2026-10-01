import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'

const require = createRequire(new URL('../../frontend/package.json', import.meta.url))
const { setupI18n } = require('@lingui/core')
const assets = new URL('../../frontend/dist/assets/', import.meta.url)
const catalogs = (await readdir(assets)).filter((file) => /^client-.*\.js$/.test(file))
assert.equal(catalogs.length, 11, 'build all shipped language catalogues first')
for (const file of catalogs) {
  const source = await readFile(new URL(file, assets), 'utf8')
  const { messages } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
  const i18n = setupI18n({ locale: 'en', messages: { en: messages } })
  assert.equal(i18n._('HT0SUg'), 'Series completion', file)
  assert.equal(i18n._('f_Y6NB', { readCount: 10, mainCount: 20 }), '10 / 20 main chapters', file)
  assert.equal(i18n._('f_Y6NB', { readCount: 1, mainCount: 1 }), '1 / 1 main chapter', file)
}
console.log('Completion labels render correctly in all 11 compiled catalogues')
