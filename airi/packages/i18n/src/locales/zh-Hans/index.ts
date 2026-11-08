import base from './base.yaml'
import companionControls from './companion-controls.yaml'
import companionErrors from './companion-errors.yaml'
import companionExtra from './companion-extra.yaml'
import companionProviders from './companion-providers.yaml'
import companionSpeech from './companion-speech.yaml'
import companionUi from './companion-ui.yaml'
import dshPet from './dsh-pet.yaml'
import server from './server'
import settings from './settings.yaml'
import stage from './stage.yaml'
import tamagotchi from './tamagotchi'
import wowAddons from './wow-addons.yaml'
import wowBuildReference from './wow-build-reference.yaml'
import wowBuilds from './wow-builds.yaml'
import wowCompanion from './wow-companion.yaml'
import wowData from './wow-data.yaml'
import wowProfessions from './wow-professions.yaml'
import wowQuestReference from './wow-quest-reference.yaml'
import wowQuests from './wow-quests.yaml'
import wowReference from './wow-reference.yaml'
import wowRetailQuery from './wow-retail-query.yaml'
import wowRetail from './wow-retail.yaml'
import wowStatistics from './wow-statistics.yaml'

export default {
  'dsh-pet': dshPet,
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
  'wow-build-reference': wowBuildReference,
  'wow-builds': wowBuilds,
  'wow-companion': wowCompanion,
  'wow-statistics': wowStatistics,
  'wow-data': wowData,
  'wow-professions': wowProfessions,
  'wow-quest-reference': wowQuestReference,
  'wow-quests': wowQuests,
  'wow-reference': wowReference,
  'wow-retail': wowRetail,
  'wow-retail-query': wowRetailQuery,
}
