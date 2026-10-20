import { create } from 'zustand'
import { repo } from '@/lib/db'
import type { Session } from '@/lib/types'

type State = {
  sessions: Session[]
  status: 'idle' | 'loading' | 'ready' | 'error'
  error?: string
  refresh: () => Promise<void>
}

export const useSessions = create<State>((set, get) => ({
  sessions: [],
  status: 'idle',
  refresh: async () => {
    if (get().status === 'idle') set({ status: 'loading' })
    try {
      set({ sessions: await repo.listSessions(), status: 'ready', error: undefined })
    } catch (e) {
      set({ status: 'error', error: e instanceof Error ? e.message : String(e) })
    }
  },
}))
