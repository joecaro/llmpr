/**
 * Config file loading - supports .llmprrc.json and ~/.config/llmpr/config.json
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { AppConfig, CliOptions } from './types.js'

/**
 * Attempt to load and parse a JSON config file. Returns null if not found.
 */
function loadJsonFile(filepath: string): AppConfig | null {
	try {
		const content = readFileSync(filepath, 'utf8')
		return JSON.parse(content)
	} catch {
		return null
	}
}

/**
 * Load config from project-level or user-level config files.
 * Priority: .llmprrc.json (project) > ~/.config/llmpr/config.json (user)
 */
export function loadConfig(): AppConfig {
	// Project-level config
	const projectConfig = loadJsonFile(join(process.cwd(), '.llmprrc.json'))
	if (projectConfig) return projectConfig

	// User-level config
	const userConfig = loadJsonFile(join(homedir(), '.config', 'llmpr', 'config.json'))
	if (userConfig) return userConfig

	return {}
}

/**
 * Merge config file values with CLI options.
 * CLI options take precedence over config file values.
 * Only applies config values where the CLI option is still at its default.
 */
export function mergeConfigWithDefaults(cliOptions: CliOptions, config: AppConfig, defaults: Record<string, unknown>): CliOptions {
	const merged = { ...cliOptions }

	// Only apply config if CLI option is at its default value
	if (config.base && cliOptions.base === defaults.base) merged.base = config.base
	if (config.model && cliOptions.model === defaults.model) merged.model = config.model
	if (config.style && cliOptions.style === defaults.style) merged.style = config.style
	if (config.maxLength && cliOptions.maxLength === defaults.maxLength) merged.maxLength = config.maxLength
	if (config.provider && cliOptions.provider === defaults.provider) merged.provider = config.provider
	if (config.verbose !== undefined && cliOptions.verbose === defaults.verbose) merged.verbose = config.verbose

	return merged
}
