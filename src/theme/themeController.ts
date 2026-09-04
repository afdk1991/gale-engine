import { createThemeController } from './useTheme'

export const themeController = createThemeController({
  loadSettings: () => window.gale.settings.get(),
  saveSettings: (patch) => window.gale.settings.set(patch)
})
