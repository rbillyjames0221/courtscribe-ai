import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { AudioChunk, Bookmark, Segment, Session } from './types'

interface CSDB extends DBSchema {
  sessions: { key: string; value: Session; indexes: { byUpdated: number } }
  segments: { key: string; value: Segment; indexes: { bySession: string } }
  bookmarks: { key: string; value: Bookmark; indexes: { bySession: string } }
  chunks: { key: string; value: AudioChunk; indexes: { bySession: string } }
}

let dbp: Promise<IDBPDatabase<CSDB>> | null = null
export function db() {
  if (!dbp) {
    dbp = openDB<CSDB>('courtscribe', 1, {
      upgrade(d) {
        d.createObjectStore('sessions', { keyPath: 'id' }).createIndex('byUpdated', 'updatedAt')
        d.createObjectStore('segments', { keyPath: 'id' }).createIndex('bySession', 'sessionId')
        d.createObjectStore('bookmarks', { keyPath: 'id' }).createIndex('bySession', 'sessionId')
        d.createObjectStore('chunks', { keyPath: 'id' }).createIndex('bySession', 'sessionId')
      },
    })
  }
  return dbp
}

export const repo = {
  async listSessions(): Promise<Session[]> {
    const all = await (await db()).getAll('sessions')
    return all.sort((a, b) => b.updatedAt - a.updatedAt)
  },
  async getSession(id: string) {
    return (await db()).get('sessions', id)
  },
  async putSession(s: Session) {
    await (await db()).put('sessions', s)
  },
  async segments(sessionId: string): Promise<Segment[]> {
    return (await db()).getAllFromIndex('segments', 'bySession', sessionId)
  },
  /** Idempotent upsert keyed by stable segment id. */
  async putSegments(segs: Segment[]) {
    if (!segs.length) return
    const tx = (await db()).transaction('segments', 'readwrite')
    await Promise.all([...segs.map((s) => tx.store.put(s)), tx.done])
  },
  async bookmarks(sessionId: string): Promise<Bookmark[]> {
    return (await db()).getAllFromIndex('bookmarks', 'bySession', sessionId)
  },
  async putBookmark(b: Bookmark) {
    await (await db()).put('bookmarks', b)
  },
  async deleteBookmark(id: string) {
    await (await db()).delete('bookmarks', id)
  },
  /** Chunk ids are `${sessionId}:${seq}` — `add` refuses to overwrite an existing chunk. */
  async addChunk(c: AudioChunk) {
    const d = await db()
    const existing = await d.get('chunks', c.id)
    if (existing) return false
    await d.add('chunks', c)
    return true
  },
  async chunks(sessionId: string): Promise<AudioChunk[]> {
    const list = await (await db()).getAllFromIndex('chunks', 'bySession', sessionId)
    return list.sort((a, b) => a.seq - b.seq)
  },
  async chunkStats(sessionId: string) {
    const d = await db()
    let count = 0
    let bytes = 0
    let lastSeq = 0
    let lastEnd = 0
    let cursor = await d.transaction('chunks').store.index('bySession').openCursor(sessionId)
    while (cursor) {
      count++
      bytes += cursor.value.size
      lastSeq = Math.max(lastSeq, cursor.value.seq)
      lastEnd = Math.max(lastEnd, cursor.value.endMs)
      cursor = await cursor.continue()
    }
    return { count, bytes, lastSeq, lastEnd }
  },
  async deleteSession(id: string) {
    const d = await db()
    const tx = d.transaction(['sessions', 'segments', 'bookmarks', 'chunks'], 'readwrite')
    await tx.objectStore('sessions').delete(id)
    for (const store of ['segments', 'bookmarks', 'chunks'] as const) {
      let c = await tx.objectStore(store).index('bySession').openCursor(id)
      while (c) {
        await c.delete()
        c = await c.continue()
      }
    }
    await tx.done
  },
  async clearAll() {
    const d = await db()
    const tx = d.transaction(['sessions', 'segments', 'bookmarks', 'chunks'], 'readwrite')
    await Promise.all([
      tx.objectStore('sessions').clear(),
      tx.objectStore('segments').clear(),
      tx.objectStore('bookmarks').clear(),
      tx.objectStore('chunks').clear(),
      tx.done,
    ])
  },
  async exportBackup() {
    const d = await db()
    return {
      format: 'courtscribe-backup-v1',
      exportedAt: new Date().toISOString(),
      note: 'Transcript data only. Audio is not included in this backup.',
      sessions: await d.getAll('sessions'),
      segments: await d.getAll('segments'),
      bookmarks: await d.getAll('bookmarks'),
    }
  },
  async importBackup(data: { sessions?: Session[]; segments?: Segment[]; bookmarks?: Bookmark[] }) {
    const d = await db()
    const tx = d.transaction(['sessions', 'segments', 'bookmarks'], 'readwrite')
    for (const s of data.sessions ?? []) if (!(await tx.objectStore('sessions').get(s.id))) await tx.objectStore('sessions').put(s)
    for (const s of data.segments ?? []) if (!(await tx.objectStore('segments').get(s.id))) await tx.objectStore('segments').put(s)
    for (const b of data.bookmarks ?? []) if (!(await tx.objectStore('bookmarks').get(b.id))) await tx.objectStore('bookmarks').put(b)
    await tx.done
  },
}

export async function storageEstimate() {
  try {
    const e = await navigator.storage?.estimate?.()
    const persisted = (await navigator.storage?.persisted?.()) ?? false
    return { usage: e?.usage ?? 0, quota: e?.quota ?? 0, persisted }
  } catch {
    return { usage: 0, quota: 0, persisted: false }
  }
}
