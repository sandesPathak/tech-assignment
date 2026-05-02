// seat-plate.test.tsx — verify the SeatPlate component renders avatar +
// display name without needing a full React renderer. We use
// React.createElement / inspect children directly — same approach the
// rest of the suite takes (no @testing-library dep).

import * as React from 'react'
import { SeatPlate } from '../components/SeatPlate'
import { Avatar } from '../components/Avatar'

function findChildren(el: any): any[] {
  if (!el || !el.props) return []
  const c = el.props.children
  if (c == null) return []
  return Array.isArray(c) ? c.flat(Infinity) : [c]
}

function findByTag(root: any, tag: any): any | null {
  if (!root || typeof root !== 'object') return null
  if (root.type === tag) return root
  for (const child of findChildren(root)) {
    const hit = findByTag(child, tag)
    if (hit) return hit
  }
  return null
}

function flatText(root: any): string {
  if (root == null) return ''
  if (typeof root === 'string' || typeof root === 'number') return String(root)
  if (Array.isArray(root)) return root.map(flatText).join(' ')
  if (root && typeof root === 'object' && 'props' in root) {
    return flatText(root.props.children)
  }
  return ''
}

describe('<SeatPlate>', () => {
  test('renders display name + avatar for a populated seat', () => {
    const tree: any = (SeatPlate as any)({
      player: {
        seat: 2,
        username: 'Alice',
        displayName: 'Alice_99',
        avatarId: '7',
        stack: 200,
      },
    })
    // Pick the Avatar element out of the tree.
    const avatar = findByTag(tree, Avatar)
    expect(avatar).toBeTruthy()
    expect(avatar.props.avatarId).toBe('7')
    expect(flatText(tree)).toContain('Alice_99')
    expect(flatText(tree)).toContain('200')
  })

  test('falls back to username when displayName is absent', () => {
    const tree: any = (SeatPlate as any)({
      player: {
        seat: 1,
        username: 'Bob',
        avatarId: '3',
        stack: 100,
      },
    })
    expect(flatText(tree)).toContain('Bob')
  })

  test('renders empty-seat placeholder when player is null', () => {
    const tree: any = (SeatPlate as any)({ player: null })
    expect(flatText(tree)).toContain('Empty seat')
    expect(findByTag(tree, Avatar)).toBeNull()
  })

  test('hero=true changes the visible style classes', () => {
    const heroTree: any = (SeatPlate as any)({
      player: { seat: 1, username: 'Alice', avatarId: '1' },
      hero: true,
    })
    const reg: any = (SeatPlate as any)({
      player: { seat: 1, username: 'Alice', avatarId: '1' },
      hero: false,
    })
    expect(heroTree.props.className).toContain('emerald')
    expect(reg.props.className).not.toContain('emerald')
  })
})
