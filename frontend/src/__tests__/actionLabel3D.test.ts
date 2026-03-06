import { describe, it, expect } from 'vitest'
import { actionLabel3D } from '../3d/hooks/useVLARunner3D'

describe('actionLabel3D', () => {
  it('MOVE_TCP_TO formats x,y,z to 3 decimal places', () => {
    expect(actionLabel3D({ type: 'MOVE_TCP_TO', x: 0.1, y: 0.4, z: 0.55 }))
      .toBe('MOVE_TCP_TO(0.100, 0.400, 0.550)')
  })

  it('MOVE_TCP_TO treats null/undefined as 0', () => {
    expect(actionLabel3D({ type: 'MOVE_TCP_TO', x: null, y: null, z: null }))
      .toBe('MOVE_TCP_TO(0.000, 0.000, 0.000)')
    expect(actionLabel3D({ type: 'MOVE_TCP_TO' }))
      .toBe('MOVE_TCP_TO(0.000, 0.000, 0.000)')
  })

  it('SET_GRIP formats width in meters', () => {
    expect(actionLabel3D({ type: 'SET_GRIP', width: 0.1 }))
      .toBe('SET_GRIP(0.100m)')
  })

  it('SET_GRIP treats null width as 0', () => {
    expect(actionLabel3D({ type: 'SET_GRIP', width: null }))
      .toBe('SET_GRIP(0.000m)')
  })

  it('other action types return type string as-is', () => {
    expect(actionLabel3D({ type: 'GRASP' })).toBe('GRASP')
    expect(actionLabel3D({ type: 'RELEASE' })).toBe('RELEASE')
    expect(actionLabel3D({ type: 'WAIT' })).toBe('WAIT')
    expect(actionLabel3D({ type: 'DONE' })).toBe('DONE')
  })
})
