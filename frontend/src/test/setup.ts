import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { MotionGlobalConfig } from 'motion/react'
import { afterEach } from 'vitest'

// jsdom + fake timers cannot drive motion's animation loop, so AnimatePresence
// exit animations never complete and removed elements stay in the DOM. Skip
// animations in tests; exit/enter complete instantly instead.
MotionGlobalConfig.skipAnimations = true

afterEach(() => {
  cleanup()
})
