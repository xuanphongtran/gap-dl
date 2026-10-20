import { describe, expect, it } from 'vitest'
import { parseRealtimeFrame, parseRoomPresence, websocketURL } from './realtime'

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
  it('isolates invalid activity without retaining its payload', () => {
    expect(
      parseRealtimeFrame(
        JSON.stringify({
          type: 'presence_snapshot',
          room_id: '7',
          payload: { private: 'untrusted' },
        }),
      ),
    ).toEqual({
      events: [],
      malformed: false,
      invalidActivityRooms: [7],
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
          room_id: 7,
          revision: 1,
          edited_at: null,
          deleted_at: null,
          mention_user_ids: [],
          attachments: [],
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

const dto = {
  id: 9,
  room_id: 7,
  user_id: null,
  username: 'Deleted user',
  content: '',
  created_at: '2026-10-20T00:00:00Z',
  revision: 2,
  edited_at: null,
  deleted_at: null,
  mention_user_ids: [],
  attachments: [],
}
it.each(['message', 'message_updated', 'message_deleted'] as const)(
  'validates %s nullable author DTO and returns safe hint only',
  (type) => {
    const payload = {
      ...dto,
      ...(type === 'message_deleted' ? { deleted_at: '2026-10-20T01:00:00Z' } : {}),
    }
    const parsed = parseRealtimeFrame(JSON.stringify({ type, room_id: '7', payload }))
    expect(parsed).toEqual({
      events: [{ type, roomId: 7, payload: { id: 9, revision: 2 } }],
      malformed: false,
    })
    expect(JSON.stringify(parsed)).not.toMatch(/username|content|attachments|created_at/)
  },
)
it.each([
  { room_id: 8 },
  { revision: undefined },
  { revision: 0 },
  { id: 9007199254740992 },
  { created_at: 'yesterday' },
  { edited_at: 'not-date' },
  { mention_user_ids: [0] },
  { attachments: undefined },
])('rejects invalid lifecycle fields %j', (patch) => {
  expect(
    parseRealtimeFrame(
      JSON.stringify({ type: 'message_updated', room_id: '7', payload: { ...dto, ...patch } }),
    ).malformed,
  ).toBe(true)
})
it('rejects nonempty tombstones and malformed file metadata', () => {
  for (const payload of [
    { ...dto, content: 'erased' },
    { ...dto, attachments: [{ id: 10 }] },
  ])
    expect(
      parseRealtimeFrame(
        JSON.stringify({
          type: 'message_deleted',
          room_id: '7',
          payload: { ...payload, deleted_at: '2026-10-20T01:00:00Z' },
        }),
      ).malformed,
    ).toBe(true)
})
it('validates and projects presence snapshots for HTTP and WS', () => {
  const p = { room_id: '7', online_user_ids: [3, 2], typing_user_ids: [2], private: 'ignored' }
  expect(parseRoomPresence(p, 7)).toEqual({
    room_id: '7',
    online_user_ids: [2, 3],
    typing_user_ids: [2],
  })
  expect(parseRoomPresence({ ...p, room_id: '8' }, 7)).toBeNull()
  expect(parseRoomPresence({ ...p, online_user_ids: [2, 2] }, 7)).toBeNull()
  expect(parseRoomPresence({ ...p, typing_user_ids: [0] }, 7)).toBeNull()
  expect(
    parseRealtimeFrame(JSON.stringify({ type: 'presence_snapshot', room_id: '7', payload: p }))
      .events[0],
  ).toEqual({ type: 'presence_snapshot', roomId: 7, payload: parseRoomPresence(p, 7) })
})
it('validates presence and typing payloads, keeping bad activity isolated from durable recovery', () => {
  const frame = [
    { type: 'presence', room_id: '7', payload: { user_id: 2, online: true } },
    {
      type: 'typing_started',
      room_id: '7',
      payload: { user_id: 2, expires_at: '2026-10-20T00:00:05Z' },
    },
    { type: 'typing_stopped', room_id: '7', payload: { user_id: 2, expires_at: null } },
  ]
    .map((x) => JSON.stringify(x))
    .join('\n')
  expect(parseRealtimeFrame(frame).events.map((e) => e.type)).toEqual([
    'presence',
    'typing_started',
    'typing_stopped',
  ])
  const malformed = parseRealtimeFrame(
    JSON.stringify({
      type: 'typing_stopped',
      room_id: '7',
      payload: { user_id: 2, expires_at: 'invalid' },
    }) +
      '\n' +
      JSON.stringify(removed),
  )
  expect(malformed).toEqual({
    events: [{ type: 'membership_changed', roomId: 7, payload: removed.payload }],
    malformed: false,
    invalidActivityRooms: [7],
  })
})
it.each(['not_joined', 'authorization_pending', 'rate_limited'])(
  'recognizes safe activity protocol error %s',
  (code) => {
    expect(
      parseRealtimeFrame(
        JSON.stringify({
          type: 'error',
          room_id: '7',
          payload: { code, message: 'private-detail' },
        }),
      ),
    ).toEqual({ events: [{ type: 'error', roomId: 7, payload: { code } }], malformed: false })
  },
)
