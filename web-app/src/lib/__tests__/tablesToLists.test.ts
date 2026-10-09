import { describe, expect, it } from 'vitest'
import { tablesToLists } from '../tablesToLists'

describe('tablesToLists', () => {
  it('turns a two-column table into name: value bullets', () => {
    const md = [
      'Options:',
      '| Option | When to use |',
      '|---|---|',
      '| Direct Connect | Heavy, steady traffic |',
      '| Site-to-site VPN | Cheaper, quick to set up |',
      '',
      'Pick by cost.',
    ].join('\n')
    expect(tablesToLists(md)).toBe(
      [
        'Options:',
        '',
        '- **Direct Connect**: Heavy, steady traffic',
        '- **Site-to-site VPN**: Cheaper, quick to set up',
        '',
        'Pick by cost.',
      ].join('\n')
    )
  })

  it('names the columns when there are more than two', () => {
    const md = [
      '| Service | Scope | Cost |',
      '| :--- | :---: | ---: |',
      '| VPC peering | 2 VPCs | Low |',
      '| Transit Gateway | Many VPCs | Per attachment |',
    ].join('\n')
    expect(tablesToLists(md)).toBe(
      [
        '- **VPC peering**: Scope: 2 VPCs; Cost: Low',
        '- **Transit Gateway**: Scope: Many VPCs; Cost: Per attachment',
      ].join('\n')
    )
  })

  it('leaves code blocks, lone pipes and half-streamed tables alone', () => {
    const code = '```\n| a | b |\n|---|---|\n| 1 | 2 |\n```'
    expect(tablesToLists(code)).toBe(code)
    expect(tablesToLists('Use a || b in bash')).toBe('Use a || b in bash')
    expect(tablesToLists('| A | B |')).toBe('| A | B |')
  })
})
