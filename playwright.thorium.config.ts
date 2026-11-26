import { defineConfig } from '@playwright/test'
import base from './playwright.config'

export default defineConfig({ ...base, workers: 4, use: { ...base.use, launchOptions: { executablePath: '/Applications/Thorium.app/Contents/MacOS/Thorium' } } })
