/**
 * LLM provider abstraction with retry logic and multi-round context fetching
 */

import axios from 'axios'
import ora from 'ora'
import { colors, logger } from './ui.js'
import { readFileContent } from './git.js'
import type { LLMProvider, LLMMessage, LLMProviderConfig, CliOptions } from './types.js'

/**
 * OpenAI provider
 */
export class OpenAIProvider implements LLMProvider {
	name = 'openai'
	private apiKey: string
	private baseUrl: string

	constructor(config: LLMProviderConfig) {
		this.apiKey = config.apiKey
		this.baseUrl = config.baseUrl || 'https://api.openai.com/v1'
	}

	async sendMessage(messages: LLMMessage[], model: string): Promise<string> {
		const response = await axios.post(
			`${this.baseUrl}/chat/completions`,
			{ model, messages },
			{ headers: { 'Authorization': `Bearer ${this.apiKey}` } }
		)
		return response.data.choices[0].message.content.trim()
	}
}

/**
 * Anthropic (Claude) provider
 */
export class AnthropicProvider implements LLMProvider {
	name = 'anthropic'
	private apiKey: string

	constructor(config: LLMProviderConfig) {
		this.apiKey = config.apiKey
	}

	async sendMessage(messages: LLMMessage[], model: string): Promise<string> {
		// Extract system message if present
		const systemMessages = messages.filter(m => m.role === 'system')
		const nonSystemMessages = messages.filter(m => m.role !== 'system')

		const body: Record<string, unknown> = {
			model,
			max_tokens: 4096,
			messages: nonSystemMessages.map(m => ({ role: m.role, content: m.content }))
		}

		if (systemMessages.length > 0) {
			body.system = systemMessages.map(m => m.content).join('\n\n')
		}

		const response = await axios.post(
			'https://api.anthropic.com/v1/messages',
			body,
			{
				headers: {
					'x-api-key': this.apiKey,
					'anthropic-version': '2023-06-01',
					'content-type': 'application/json'
				}
			}
		)
		return response.data.content[0].text.trim()
	}
}

/**
 * OpenAI-compatible provider (Ollama, Together, etc.)
 */
export class OpenAICompatibleProvider implements LLMProvider {
	name = 'openai-compatible'
	private apiKey: string
	private baseUrl: string

	constructor(config: LLMProviderConfig) {
		this.apiKey = config.apiKey
		this.baseUrl = config.baseUrl || 'http://localhost:11434/v1'
	}

	async sendMessage(messages: LLMMessage[], model: string): Promise<string> {
		const headers: Record<string, string> = { 'content-type': 'application/json' }
		if (this.apiKey) {
			headers['Authorization'] = `Bearer ${this.apiKey}`
		}

		const response = await axios.post(
			`${this.baseUrl}/chat/completions`,
			{ model, messages },
			{ headers }
		)
		return response.data.choices[0].message.content.trim()
	}
}

/**
 * Create an LLM provider based on the provider name
 */
export function createProvider(providerName: string, config?: LLMProviderConfig): LLMProvider {
	const resolvedConfig = config || resolveProviderConfig(providerName)

	switch (providerName) {
		case 'openai':
			return new OpenAIProvider(resolvedConfig)
		case 'anthropic':
			return new AnthropicProvider(resolvedConfig)
		case 'openai-compatible':
			return new OpenAICompatibleProvider(resolvedConfig)
		default:
			throw new Error(`Unknown provider: ${providerName}. Supported: openai, anthropic, openai-compatible`)
	}
}

/**
 * Resolve API key from environment variables
 */
function resolveProviderConfig(providerName: string): LLMProviderConfig {
	switch (providerName) {
		case 'openai': {
			const apiKey = process.env.OPENAI_API_KEY
			if (!apiKey) {
				throw new Error('OPENAI_API_KEY environment variable is not set.\nSet it using: export OPENAI_API_KEY=your_api_key')
			}
			return { apiKey }
		}
		case 'anthropic': {
			const apiKey = process.env.ANTHROPIC_API_KEY
			if (!apiKey) {
				throw new Error('ANTHROPIC_API_KEY environment variable is not set.\nSet it using: export ANTHROPIC_API_KEY=your_api_key')
			}
			return { apiKey }
		}
		case 'openai-compatible': {
			return {
				apiKey: process.env.LLM_API_KEY || '',
				baseUrl: process.env.LLM_BASE_URL || 'http://localhost:11434/v1'
			}
		}
		default:
			throw new Error(`Unknown provider: ${providerName}`)
	}
}

/**
 * Sleep helper for retry backoff
 */
function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Send a message with retry and exponential backoff
 */
async function sendWithRetry(provider: LLMProvider, messages: LLMMessage[], model: string, maxRetries = 3): Promise<string> {
	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			return await provider.sendMessage(messages, model)
		} catch (error: unknown) {
			const isLast = attempt === maxRetries

			// Extract error details
			let statusCode: number | undefined
			let errorMessage = 'Unknown error'

			if (error && typeof error === 'object') {
				const axiosError = error as { response?: { status?: number; data?: { error?: { message?: string } } }; message?: string }
				statusCode = axiosError.response?.status
				errorMessage = axiosError.response?.data?.error?.message || axiosError.message || String(error)
			} else if (error instanceof Error) {
				errorMessage = error.message
			}

			// Don't retry on auth errors or bad requests
			if (statusCode === 401 || statusCode === 403 || statusCode === 400) {
				throw new Error(`API Error (${statusCode}): ${errorMessage}`)
			}

			if (isLast) {
				throw new Error(`API Error after ${maxRetries} attempts: ${errorMessage}`)
			}

			const delay = Math.pow(2, attempt - 1) * 1000 // 1s, 2s, 4s
			logger.warning(`Attempt ${attempt}/${maxRetries} failed, retrying in ${delay / 1000}s...`)
			await sleep(delay)
		}
	}

	throw new Error('Unexpected: retry loop exhausted')
}

/**
 * Strip markdown code block wrappers from LLM response
 */
function stripCodeBlocks(content: string): string {
	if (content.startsWith('```') && content.includes('\n')) {
		const lines = content.split('\n')
		if (lines[0].startsWith('```') && lines[lines.length - 1] === '```') {
			return lines.slice(1, lines.length - 1).join('\n')
		}
		if (lines[0].startsWith('```')) {
			const endIndex = lines.findIndex((line: string, i: number) => i > 0 && line === '```')
			if (endIndex !== -1) {
				return lines.slice(1, endIndex).join('\n')
			}
		}
	}
	return content
}

/**
 * Main function to send a prompt with multi-round context fetching
 */
export async function sendPrompt(
	provider: LLMProvider,
	prompt: string,
	options: Pick<CliOptions, 'model' | 'verbose'>,
	taskName = 'PR description'
): Promise<string> {
	const capitalizedTask = taskName.charAt(0).toUpperCase() + taskName.slice(1)
	const spinner = ora({
		text: `Generating ${taskName} using ${colors.highlight(options.model)}...`,
		spinner: 'dots'
	}).start()

	try {
		if (options.verbose) {
			spinner.stop()
			logger.title('API Request')
			logger.box(prompt, 'Prompt')
			spinner.start()
		}

		const startTime = Date.now()
		let content = await sendWithRetry(provider, [{ role: 'system', content: prompt }], options.model)

		// Multi-round context fetching
		const maxRounds = 3
		let currentRound = 1

		while (currentRound < maxRounds) {
			const contextRequests = [...content.matchAll(/\[NEED_CONTEXT:([^\]]+)\]/g)]

			if (contextRequests.length === 0) break

			if (options.verbose) {
				const requestedFiles = contextRequests.map(match => match[1].trim())
				logger.info(`AI requested additional context for files (round ${currentRound + 1}): ${requestedFiles.join(', ')}`)
			}

			spinner.text = `Round ${currentRound + 1}/${maxRounds}: Fetching additional context...`

			const additionalContext = await Promise.all(
				contextRequests.map(async match => {
					const filepath = match[1].trim()
					try {
						const fileContent = readFileContent(filepath)
						return `File content for ${filepath}:\n\`\`\`\n${fileContent}\n\`\`\``
					} catch (error: unknown) {
						const errorMessage = error instanceof Error ? error.message : String(error)
						return `Error reading ${filepath}: ${errorMessage}`
					}
				})
			)

			const followUpPrompt = `
You previously requested additional context to complete the ${taskName}.
Here is the requested context:

${additionalContext.join('\n\n')}

Based on this additional information, please generate the complete ${taskName} as requested originally.
Do NOT request more context with [NEED_CONTEXT:filepath]. This is your final opportunity to generate the ${taskName}.
`

			spinner.text = `Round ${currentRound + 1}/${maxRounds}: Generating improved ${taskName}...`
			content = await sendWithRetry(
				provider,
				[
					{ role: 'system', content: prompt },
					{ role: 'assistant', content },
					{ role: 'user', content: followUpPrompt }
				],
				options.model
			)

			currentRound++
		}

		const endTime = Date.now()
		const duration = ((endTime - startTime) / 1000).toFixed(2)

		spinner.succeed(`${capitalizedTask} generated in ${colors.highlight(duration + 's')} after ${currentRound} round${currentRound === 1 ? '' : 's'}`)

		if (options.verbose) {
			logger.title('API Response')
			logger.info(`Model: ${colors.highlight(options.model)}`)
			logger.info(`Rounds of context: ${colors.highlight(currentRound.toString())}`)
			logger.info(`Duration: ${colors.highlight(duration + 's')}`)
		}

		// Clean up response
		content = content.replace(/\[NEED_CONTEXT:[^\]]+\]/g, '')
		content = stripCodeBlocks(content)

		return content
	} catch (error: unknown) {
		spinner.fail(`Failed to generate ${taskName}`)
		let errorMessage = 'Unknown error'

		if (error instanceof Error) {
			errorMessage = error.message
		} else if (error && typeof error === 'object') {
			const axiosError = error as { response?: { data?: { error?: { message?: string } } } }
			if (axiosError.response?.data?.error?.message) {
				errorMessage = axiosError.response.data.error.message
			}
		} else {
			errorMessage = String(error)
		}

		throw new Error(`LLM API Error: ${errorMessage}`)
	}
}

/**
 * Compress a title using the LLM (for suggested PR titles)
 */
export async function compressTitleWithLLM(
	provider: LLMProvider,
	baseTitle: string,
	changedFiles: string[],
	model: string
): Promise<string | undefined> {
	const prompt = `
You write extremely short PR titles (6-8 words max).
Return only the title text, no quotes, no punctuation at the end.

Context:
- Base title: ${baseTitle}
- Key areas: ${changedFiles.slice(0, 6).join(', ') || 'n/a'}
`.trim()

	try {
		return await sendWithRetry(provider, [{ role: 'system', content: prompt }], model)
	} catch {
		return undefined
	}
}
