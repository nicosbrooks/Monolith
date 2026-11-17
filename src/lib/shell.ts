import { create } from 'zustand'

/** Whether the Library (docs, folders, recordings, sources) is open over the page. */
export const useShell = create<{ library: boolean }>(() => ({ library: false }))
export const toggleLibrary = (on?: boolean) => useShell.setState((s) => ({ library: on ?? !s.library }))
