import { lstat, readFile, rename, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { requireLoopback } from './acceptance-browser.mjs'
import { openFixtureJournal } from './live-fixture-journal.mjs'

const load = async (file, fallback) => {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch (e) {
    if (e.code === 'ENOENT') return fallback
    // JSON errors can contain credentials; the original cause must stay private.
    // eslint-disable-next-line preserve-caught-error
    throw Error('Invalid private fixture registry')
  }
}
const save = async (file, data) => {
  const temporary = file + '.' + randomUUID()
  await writeFile(temporary, JSON.stringify(data), { mode: 0o600, flag: 'wx' })
  await rename(temporary, file)
}
export async function prepareRealtimeFixtures({ directory, apiOrigin }) {
  requireLoopback(apiOrigin)
  if (!directory || !isAbsolute(directory))
    throw Error('An absolute private fixture directory is required')
  const info = await lstat(directory)
  if (!info.isDirectory() || info.isSymbolicLink() || info.mode & 0o077)
    throw Error('Fixture directory must be private')
  const registryFile = join(directory, 'registry.json'),
    retainedFile = join(directory, 'retained.json'),
    temporaryFile = join(directory, 'temporary.json')
  const registry = await load(registryFile, { apiOrigin, rooms: {}, guests: [] })
  if (registry.apiOrigin !== apiOrigin) throw Error('Fixture registry origin mismatch')
  const retained = await load(retainedFile, { entries: [] })
  if (retained.entries.some((e) => e.status === 'uncertain' || e.status === 'cleaning'))
    throw Error('Unresolved uncertain retained write; reconcile the private journal')
  const checks = [],
    cleanupChecks = []
  const persist = () => save(registryFile, registry)
  async function raw(account, method, path, body) {
    if (!path.startsWith('/api/v1/') || path.includes('://') || path.includes('..'))
      throw Error('Invalid fixture API path')
    let response
    try {
      response = await fetch(apiOrigin + path, {
        method,
        headers: {
          ...(account ? { Authorization: 'Bearer ' + account.session.access_token } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(15000),
      })
    } catch {
      throw Error('Local fixture request failed; reconcile uncertain writes')
    }
    let data = {}
    try {
      data = JSON.parse(await response.text())
    } catch {
      /* Empty response. */
    }
    checks.push({
      method,
      path: new URL(path, apiOrigin).pathname.replace(/\/\d+/g, '/:id'),
      status: response.status,
      requestId: response.headers.get('x-request-id'),
    })
    return { status: response.status, data, headers: response.headers }
  }
  function successful(result) {
    if (result.status < 200 || result.status >= 300)
      throw Error('Local fixture API returned ' + result.status)
    return result
  }
  async function register(kind) {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 16)
    const credentials = {
      email: 'realtime-' + suffix + '@example.test',
      username: 'rt_' + suffix,
      password: 'Rt-' + randomUUID(),
    }
    const journal = await openFixtureJournal(
      kind === 'retained-owner' ? retainedFile : temporaryFile,
    )
    return journal.write({ kind, apiOrigin, recovery: credentials }, async () => {
      const session = successful(await raw(null, 'POST', '/api/v1/auth/register', credentials)).data
      const account = { credentials, session }
      // Preserve successful tokens even if profile lookup is interrupted.
      if (kind === 'retained-owner') registry.owner = account
      else registry.guests.push(account)
      await persist()
      const profile = successful(await raw(account, 'GET', '/api/v1/users/me')).data
      if (!Number.isSafeInteger(profile.id) || profile.id <= 0)
        throw Error('Invalid fixture account identity')
      account.id = profile.id
      await persist()
      return account
    })
  }
  async function verify(account) {
    if (!account?.id || !account.session?.access_token)
      throw Error('Unresolved fixture account identity')
    let result = await raw(account, 'GET', '/api/v1/users/me')
    if (result.status === 401) {
      account.session = successful(
        await raw(null, 'POST', '/api/v1/auth/login', account.credentials),
      ).data
      await persist()
      result = await raw(account, 'GET', '/api/v1/users/me')
    }
    if (successful(result).data.id !== account.id) throw Error('Fixture account identity mismatch')
  }
  if (!registry.owner) registry.owner = await register('retained-owner')
  else await verify(registry.owner)
  for (const visibility of ['public', 'private']) {
    const recorded = retained.entries.find(
      (e) =>
        e.kind === 'retained-room' &&
        e.status === 'created' &&
        e.recovery.visibility === visibility,
    )
    if (!registry.rooms[visibility] && recorded?.resource) {
      registry.rooms[visibility] = recorded.resource
      await persist()
    }
    if (!registry.rooms[visibility]) {
      const journal = await openFixtureJournal(retainedFile)
      registry.rooms[visibility] = await journal.write(
        { kind: 'retained-room', apiOrigin, recovery: { visibility, ownerId: registry.owner.id } },
        async () => {
          const room = successful(
            await raw(registry.owner, 'POST', '/api/v1/rooms', {
              name: 'Realtime local ' + visibility + ' ' + randomUUID().slice(0, 8),
              visibility,
            }),
          ).data
          if (!Number.isSafeInteger(room.id) || room.id <= 0)
            throw Error('Invalid retained room identity')
          return { id: room.id, visibility }
        },
      )
      await persist()
    } else {
      const room = successful(
        await raw(registry.owner, 'GET', '/api/v1/rooms/' + registry.rooms[visibility].id),
      ).data
      if (room.id !== registry.rooms[visibility].id || room.role !== 'owner')
        throw Error('Retained room ownership mismatch')
    }
  }
  const fixtureIds = () => new Set(Object.values(registry.rooms).map((r) => r.id))
  async function request(account, method, path, body) {
    if (![registry.owner, ...registry.guests].some((a) => a.id === account.id))
      throw Error('Unknown fixture actor')
    const room = path.match(/^\/api\/v1\/rooms\/(\d+)/)
    if (room && !fixtureIds().has(Number(room[1])))
      throw Error('Request outside retained fixture rooms')
    if (method === 'GET') return raw(account, method, path, body)
    const recorded = await load(temporaryFile, { entries: [] })
    const messagePath = path.match(/^(\/api\/v1\/rooms\/\d+\/messages)(?:\/(\d+))?$/)
    const message =
      messagePath &&
      ((method === 'POST' && !messagePath[2]) ||
        (['PATCH', 'DELETE'].includes(method) &&
          messagePath[2] &&
          recorded.entries.some(
            (e) =>
              e.kind === 'operation' &&
              e.recovery.method === 'POST' &&
              e.recovery.path === messagePath[1] &&
              e.resource?.status === 201 &&
              e.resource.data.id === Number(messagePath[2]),
          )))
    const join = method === 'POST' && path.endsWith('/join')
    const leave =
      method === 'DELETE' && path.endsWith('/membership') && account.id !== registry.owner.id
    const invite =
      method === 'POST' &&
      path.endsWith('/invitations') &&
      registry.guests.some((a) => a.id === body?.user_id)
    const member = path.match(/\/members\/(\d+)$/)
    const memberAction =
      member &&
      registry.guests.some((a) => a.id === Number(member[1])) &&
      (method === 'DELETE' || (method === 'PATCH' && ['member', 'moderator'].includes(body?.role)))
    const respond =
      /^\/api\/v1\/invitations\/\d+\/(accept|decline)$/.test(path) &&
      account.id !== registry.owner.id &&
      recorded.entries.some(
        (e) =>
          e.kind === 'operation' &&
          e.recovery.method === 'POST' &&
          e.recovery.path?.endsWith('/invitations') &&
          e.recovery.body?.user_id === account.id &&
          e.resource?.status === 201 &&
          e.resource.data.id === Number(path.split('/')[4]),
      )
    if (!message && !join && !leave && !invite && !memberAction && !respond)
      throw Error('Mutation outside disposable fixture resources or retained owner')
    const journal = await openFixtureJournal(temporaryFile)
    const resource = await journal.write(
      { kind: 'operation', apiOrigin, recovery: { userId: account.id, method, path, body } },
      async () => {
        const result = await raw(account, method, path, body)
        if (result.status >= 500) throw Error('Uncertain fixture write result')
        return { status: result.status, data: result.data }
      },
    )
    return { ...resource, headers: new Headers() }
  }
  async function cleanup({ minimumWriteIntervalMs = 0 } = {}) {
    if (
      !Number.isSafeInteger(minimumWriteIntervalMs) ||
      minimumWriteIntervalMs < 0 ||
      minimumWriteIntervalMs > 2000
    )
      throw Error('Invalid cleanup pacing')
    const journal = await load(temporaryFile, { entries: [] })
    // Resolve messages before memberships, then delete disposable accounts.
    const operations = journal.entries.filter((e) => e.kind === 'operation'),
      accounts = journal.entries.filter((e) => e.kind === 'guest')
    const errors = []
    for (const e of [...operations, ...accounts]) {
      if (e.status === 'cleaned') continue
      if (!e.resource) {
        errors.push('uncertain')
        continue
      }
      if (minimumWriteIntervalMs)
        await new Promise((resolve) => setTimeout(resolve, minimumWriteIntervalMs))
      e.status = 'cleaning'
      await save(temporaryFile, journal)
      try {
        if (e.apiOrigin !== apiOrigin) throw Error('Cleanup origin mismatch')
        if (e.kind === 'guest') {
          if (e.resource.id === registry.owner.id) throw Error('Retained owner cannot be deleted')
          const account = registry.guests.find((a) => a.id === e.resource.id)
          if (!account) throw Error('Unknown guest identity')
          await verify(account)
          const result = await raw(account, 'DELETE', '/api/v1/users/me')
          cleanupChecks.push({ kind: 'guest', id: account.id, status: result.status })
          if (result.status !== 204) throw Error('Guest cleanup not confirmed')
        } else {
          const { method, path, userId } = e.recovery
          const account = [registry.owner, ...registry.guests].find((a) => a.id === userId)
          if (!account) throw Error('Unknown operation actor')
          const room = path.match(/^\/api\/v1\/rooms\/(\d+)/)
          if (room && !fixtureIds().has(Number(room[1])))
            throw Error('Cleanup outside retained rooms')
          if (method === 'POST' && /\/messages$/.test(path) && e.resource.status === 201) {
            const id = e.resource.data.id
            if (!Number.isSafeInteger(id) || id <= 0) throw Error('Unresolved message identity')
            // The room owner can clean a journaled message after its author is revoked or deleted.
            await verify(registry.owner)
            const result = await raw(registry.owner, 'DELETE', path + '/' + id)
            if (result.status !== 200 || !result.data.deleted_at)
              throw Error('Message cleanup not confirmed')
          }
          // Invitations/memberships are removed by confirmed guest deletion below.
          // Reads/expected denied writes create no resource; retained rooms are never deleted.
        }
        e.status = 'cleaned'
        await save(temporaryFile, journal)
      } catch {
        errors.push(e.kind)
        await save(temporaryFile, journal)
      }
    }
    // A failed guest deletion leaves related operation cleanup unresolved too.
    for (const e of operations) {
      const guest = accounts.find(
        (a) => a.resource?.id === e.recovery.userId || a.resource?.id === e.recovery.body?.user_id,
      )
      if (guest && guest.status !== 'cleaned' && e.status === 'cleaned') {
        if (minimumWriteIntervalMs)
          await new Promise((resolve) => setTimeout(resolve, minimumWriteIntervalMs))
        e.status = 'cleaning'
        await save(temporaryFile, journal)
      }
    }
    return {
      confirmed: journal.entries.filter((e) => e.status === 'cleaned').length,
      unconfirmed: journal.entries.filter((e) => e.status !== 'cleaned').length,
      errors: errors.length,
    }
  }
  return {
    owner: registry.owner,
    rooms: registry.rooms,
    createGuest: () => register('guest'),
    request,
    cleanup,
    report: () => ({
      checks: [...checks],
      cleanupChecks: [...cleanupChecks],
      retained: [
        { kind: 'owner', id: registry.owner.id, status: 'retained' },
        ...Object.values(registry.rooms).map((r) => ({
          kind: 'room',
          id: r.id,
          status: 'retained',
        })),
      ],
    }),
  }
}
