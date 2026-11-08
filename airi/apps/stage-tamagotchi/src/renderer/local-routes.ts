import type { Router } from 'vue-router'

/** Routes renderer-specific tools to the desktop pet library before they mount a former avatar renderer. */
export function installDesktopPetRoutes(router: Router) {
  const isAvatarTool = (path: string) => /\/(?:devtools\/(?:live2d[^/]*|performance-visualizer)|settings\/models\/[^/]+)(?:\/|$)/.test(path)
  for (const route of router.getRoutes()) {
    if (isAvatarTool(route.path))
      route.meta.settingsEntry = false
  }
  return router.beforeEach(to => isAvatarTool(to.path) ? { path: '/settings/models', replace: true } : undefined)
}

/** Keeps hosted account pages outside the desktop companion's local settings. */
export function installLocalAccountRoutes(router: Router) {
  function isHostedAccountRoute(path: string) {
    return /^\/(?:auth|login)(?:\/|$)/.test(path)
      || /^(?:\/v2)?\/settings\/(?:account|flux|capacitor|voice-packs?)(?:\/|$)/.test(path)
      || /^(?:\/v2)?\/settings\/providers\/[^/]+\/(?:vision-)?official-provider(?:-[^/]+)?(?:\/|$)/.test(path)
  }

  for (const route of router.getRoutes()) {
    if (isHostedAccountRoute(route.path))
      route.meta.settingsEntry = false
  }

  return router.beforeEach(to => isHostedAccountRoute(to.path) ? { path: '/settings', replace: true } : undefined)
}
