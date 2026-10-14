import { describe, expect, it } from 'vitest'
import { parseRealtimeFrame, websocketURL } from './realtime'

const removed = {
  type: 'membership_changed',
  room_id: '7',
  payload: { action: 'removed', user_id: 2, actor_user_id: 1, role: 'member' },
}

describe('realtime protocol', () => {
  it('uses the API origin and encodes browser credentials', () => {
    expect(websocketURL('https://example.com/', 'a+b&c')).toBe(
      'wss://example.com/api/v1/ws?token=a%2Bb%26c',
    )
    expect(websocketURL('http://localhost:8080', 'test')).toBe(
      'ws://localhost:8080/api/v1/ws?token=test',
    )
    expect(() => websocketURL('file:///tmp/server', 'test')).toThrow()
  })
  it('preserves revocation in a newline batch containing a bad line', () => {
    const parsed = parseRealtimeFrame('\ninvalid\n' + JSON.stringify(removed) + '\n')
    expect(parsed.malformed).toBe(true)
    expect(parsed.events).toEqual([
      { type: 'membership_changed', roomId: 7, payload: removed.payload },
    ])
  })
  it.each(['0', '01', '-7', '9007199254740992', 7])(
    'rejects unsafe or nondecimal room IDs: %s',
    (room_id) => {
      expect(parseRealtimeFrame(JSON.stringify({ ...removed, room_id })).malformed).toBe(true)
    },
  )
  it('rejects known envelopes with invalid payloads and nontext frames', () => {
    expect(parseRealtimeFrame(new ArrayBuffer(4)).malformed).toBe(true)
    expect(
      parseRealtimeFrame(JSON.stringify({ ...removed, payload: { action: 'removed' } })).malformed,
    ).toBe(true)
    expect(
      parseRealtimeFrame(
        JSON.stringify({ type: 'message', room_id: '7', payload: { id: 1, content: 'fake' } }),
      ).malformed,
    ).toBe(true)
  })
  it('recognizes undocumented events without accepting their payload', () => {
    expect(
      parseRealtimeFrame(
        JSON.stringify({
          type: 'presence_snapshot',
          room_id: '7',
          payload: { private: 'untrusted' },
        }),
      ),
    ).toEqual({
      events: [{ type: 'unknown', roomId: 7 }],
      malformed: false,
    })
  })
  it('validates documented messages, invitations, notifications and errors', () => {
    const events = [
      {
        type: 'message',
        room_id: '7',
        payload: {
          id: 8,
          user_id: 2,
          username: 'guest',
          content: 'hello',
          created_at: '2026-10-14T00:00:00Z',
        },
      },
      {
        type: 'invitation',
        room_id: '7',
        payload: { invitation_id: 9, action: 'created', status: 'pending' },
      },
      {
        type: 'notification',
        room_id: '7',
        payload: { id: 10, kind: 'mention', room_id: 7, message_id: 8 },
      },
      {
        type: 'error',
        room_id: '',
        payload: { code: 'authorization_unavailable', message: 'untrusted detail' },
      },
    ]
    const parsed = parseRealtimeFrame(events.map((e) => JSON.stringify(e)).join('\n'))
    expect(parsed.malformed).toBe(false)
    expect(parsed.events.map((e) => [e.type, e.roomId])).toEqual([
      ['message', 7],
      ['invitation', 7],
      ['notification', 7],
      ['error', null],
    ])
  })
})

it('does not coerce membership action or role arrays into valid strings', () => {
  for (const payload of [
    { ...removed.payload, role: ['member'] },
    { ...removed.payload, action: ['removed'] },
  ]) {
    expect(parseRealtimeFrame(JSON.stringify({ ...removed, payload })).malformed).toBe(true)
  }
})
