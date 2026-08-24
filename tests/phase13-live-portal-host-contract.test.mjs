import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('live portal host contract separates lifecycle, visibility, focus, and control owner', async () => {
  const schema = JSON.parse(await readFile('contracts/phase13/live-portal-host-v1.schema.json', 'utf8'))
  const example = JSON.parse(await readFile('contracts/phase13/examples/live-portal-host-state.json', 'utf8'))

  assert.equal(schema.$id, 'https://evemisslab.com/schemas/live-portal-host-v1.schema.json')
  assert.deepEqual(schema.required, ['portalObjectId', 'mounted', 'visible', 'focused', 'controlOwner'])
  assert.equal(schema.properties.controlOwner.type[0], 'string')
  assert.equal(schema.properties.controlOwner.type[1], 'null')
  assert.deepEqual(example, {
    portalObjectId: 'portal-pmw-task-42',
    mounted: true,
    visible: true,
    focused: false,
    controlOwner: null,
  })
})
