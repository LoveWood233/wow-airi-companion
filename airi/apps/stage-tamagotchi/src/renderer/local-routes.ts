import type { Router } from 'vue-router'

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
