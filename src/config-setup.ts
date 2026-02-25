/**
 * Interactive config setup: llmpr config
 */

import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import prompts from 'prompts'
import { colors, logger } from './ui.js'
import type { AppConfig } from './types.js'

const PROVIDER_MODELS: Record<string, string[]> = {
	openai: [
		'gpt-5.2',
		'gpt-5.1',
		'gpt-5-mini',
		'gpt-4o',
		'gpt-4o-mini',
		'gpt-4-turbo',
		'gpt-4',
	],
	anthropic: [
		'claude-sonnet-4-20250514',
		'claude-3-5-sonnet-20241022',
		'claude-3-5-haiku-20241022',
		'claude-3-opus-20240229',
		'claude-3-sonnet-20240229',
	],
	'openai-compatible': [
		'llama3.2',
		'llama3.1',
		'codellama',
		'mistral',
		'qwen2.5',
	],
}

export async function runConfigSetup(): Promise<void> {
	logger.title('LLMPR Config')
	logger.info('Set your default provider and model. You can override these with flags when running llmpr.')

	const providerRes = await prompts({
		type: 'select',
		name: 'provider',
		message: 'Default provider?',
		choices: [
			{ title: 'OpenAI', value: 'openai' },
			{ title: 'Anthropic (Claude)', value: 'anthropic' },
			{ title: 'OpenAI-compatible (Ollama, etc.)', value: 'openai-compatible' },
		],
		initial: 0,
	})

	if (providerRes.provider === undefined) {
		logger.warning('Config cancelled')
		return
	}

	const models = PROVIDER_MODELS[providerRes.provider] ?? []
	const modelRes = await prompts({
		type: 'select',
		name: 'model',
		message: 'Default model?',
		choices: models.map(m => ({ title: m, value: m })),
		initial: 0,
	})

	if (modelRes.model === undefined) {
		logger.warning('Config cancelled')
		return
	}

	const config: AppConfig = {
		provider: providerRes.provider,
		model: modelRes.model,
	}

	const whereRes = await prompts({
		type: 'select',
		name: 'where',
		message: 'Save config to',
		choices: [
			{ title: 'This project (.llmprrc.json)', value: 'project' },
			{ title: 'User config (~/.config/llmpr/config.json)', value: 'user' },
		],
		initial: 0,
	})

	if (whereRes.where === undefined) {
		logger.warning('Config cancelled')
		return
	}

	let filepath: string
	if (whereRes.where === 'project') {
		filepath = join(process.cwd(), '.llmprrc.json')
	} else {
		const dir = join(homedir(), '.config', 'llmpr')
		mkdirSync(dir, { recursive: true })
		filepath = join(dir, 'config.json')
	}

	writeFileSync(filepath, JSON.stringify(config, null, 2) + '\n', 'utf8')
	logger.success(`Config written to ${colors.highlight(filepath)}`)
	logger.info(`Provider: ${colors.highlight(providerRes.provider)}, Model: ${colors.highlight(modelRes.model)}`)
}
