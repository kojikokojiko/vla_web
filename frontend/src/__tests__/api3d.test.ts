import { describe, it, expect, vi, beforeEach } from 'vitest'

const minimalState = {
  objects: [{ id: 'red', label: 'Red Cube', color: '#e74c3c', shape: 'cube', accessible: true, x: -0.25, z: 0.0 }],
  gripper: { x: 0, y: 0.4, z: 0, openWidth: 0.1, isGrasping: false, graspedId: null },
  targetBins: [{ id: 'bin_a', label: 'Bin A', color: 'red' }],
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('callVLA3D', () => {
  it('POSTs to /api/vla3d/plan with JSON body', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ actions: [], reasoning: 'ok', target_object: null, target_bin: null }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const { callVLA3D } = await import('../3d/api/vla3d')
    await callVLA3D({ instruction: 'test', image: '', image_top: '', state: minimalState as any })

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/vla3d/plan')
    expect(opts.method).toBe('POST')
    const body = JSON.parse(opts.body)
    expect(body.instruction).toBe('test')
  })

  it('throws when response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      text: async () => 'Internal Server Error',
    }))

    const { callVLA3D } = await import('../3d/api/vla3d')
    await expect(
      callVLA3D({ instruction: 'test', image: '', image_top: '', state: minimalState as any })
    ).rejects.toThrow('Internal Server Error')
  })
})

describe('callVLAStep3D', () => {
  it('POSTs to /api/vla3d/step with step and history', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ action: { type: 'WAIT' }, reasoning: '', is_done: false }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const { callVLAStep3D } = await import('../3d/api/vla3d')
    await callVLAStep3D({ instruction: 'test', image: '', image_top: '', state: minimalState as any, history: [], step: 3 })

    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/vla3d/step')
    const body = JSON.parse(opts.body)
    expect(body.step).toBe(3)
    expect(body.history).toEqual([])
  })
})
