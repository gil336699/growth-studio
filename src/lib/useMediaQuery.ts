import { useSyncExternalStore } from 'react'

// True while a CSS media query matches, such as '(pointer: coarse)' for touch screens. Updates when it changes.
export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    notify => {
      const list = window.matchMedia(query)
      list.addEventListener('change', notify)
      return () => list.removeEventListener('change', notify)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}
