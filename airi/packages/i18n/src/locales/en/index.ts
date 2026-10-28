import base from './base.yaml'
import companionControls from './companion-controls.yaml'
import companionErrors from './companion-errors.yaml'
import companionExtra from './companion-extra.yaml'
import companionProviders from './companion-providers.yaml'
import companionSpeech from './companion-speech.yaml'
import companionUi from './companion-ui.yaml'
import server from './server'
import settings from './settings.yaml'
import stage from './stage.yaml'
import tamagotchi from './tamagotchi'
import wowAddons from './wow-addons.yaml'
import wowCompanion from './wow-companion.yaml'

export default {
  base,
  server,
  settings,
  stage,
  tamagotchi,
  'companion-controls': companionControls,
  'companion-extra': companionExtra,
  'companion-providers': companionProviders,
  'companion-speech': companionSpeech,
  'companion-errors': companionErrors,
  'companion-ui': companionUi,
  'wow-addons': wowAddons,
  'wow-companion': wowCompanion,
}
