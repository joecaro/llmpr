/**
 * Shared TypeScript interfaces and types for llmpr
 */

export interface GhAccount {
	username: string
	active: boolean
	scopes: string[]
}

export interface GhAuthStatus {
	authenticated: boolean
	accounts: GhAccount[]
	activeAccount?: GhAccount
	output?: string
}

export interface RepoAccess {
	hasAccess: boolean
	repoName?: string
}

export interface CliOptions {
	base: string
	model: string
	output?: string
	review: boolean
	verbose: boolean
	style: 'concise' | 'standard' | 'verbose'
	maxLength: string
	createPr: boolean
	githubConfig: boolean
	dryRun: boolean
	provider: string
	template?: string
}

export interface LLMMessage {
	role: 'system' | 'user' | 'assistant'
	content: string
}

export interface LLMProvider {
	name: string
	sendMessage(messages: LLMMessage[], model: string): Promise<string>
}

export interface LLMProviderConfig {
	apiKey: string
	baseUrl?: string
}

export interface AppConfig {
	base?: string
	model?: string
	style?: 'concise' | 'standard' | 'verbose'
	maxLength?: string
	provider?: string
	verbose?: boolean
	providers?: {
		openai?: { apiKey?: string }
		anthropic?: { apiKey?: string }
		openaiCompatible?: { apiKey?: string; baseUrl?: string }
	}
}
