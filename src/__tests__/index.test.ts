import { jest } from '@jest/globals'

// ── git.ts tests ──

describe('git.ts', () => {
	describe('summarizeChangedAreas', () => {
		let summarizeChangedAreas: typeof import('../git.js').summarizeChangedAreas

		beforeAll(async () => {
			const git = await import('../git.js')
			summarizeChangedAreas = git.summarizeChangedAreas
		})

		test('returns undefined for empty array', () => {
			expect(summarizeChangedAreas([])).toBeUndefined()
		})

		test('returns single area summary', () => {
			const result = summarizeChangedAreas(['src/index.ts', 'src/utils.ts'])
			expect(result).toBe('Update Src')
		})

		test('returns top two areas', () => {
			const result = summarizeChangedAreas(['src/index.ts', 'tests/foo.test.ts', 'src/bar.ts'])
			expect(result).toBe('Src & Tests updates')
		})

		test('handles root-level files', () => {
			const result = summarizeChangedAreas(['README.md', 'package.json'])
			expect(result).toBe('Update Root Files')
		})
	})

	describe('summarizeCommitSubjects', () => {
		let summarizeCommitSubjects: typeof import('../git.js').summarizeCommitSubjects

		beforeAll(async () => {
			const git = await import('../git.js')
			summarizeCommitSubjects = git.summarizeCommitSubjects
		})

		test('returns undefined for empty array', () => {
			expect(summarizeCommitSubjects([])).toBeUndefined()
		})

		test('returns single commit as-is', () => {
			expect(summarizeCommitSubjects(['add login page'])).toBe('add login page')
		})

		test('strips conventional commit prefix', () => {
			expect(summarizeCommitSubjects(['feat: add login page'])).toBe('add login page')
		})

		test('strips scoped conventional commit prefix', () => {
			expect(summarizeCommitSubjects(['feat(auth): add login page'])).toBe('add login page')
		})

		test('joins two unique commits', () => {
			const result = summarizeCommitSubjects(['add login', 'fix signup'])
			expect(result).toBe('add login • fix signup')
		})

		test('deduplicates commits', () => {
			const result = summarizeCommitSubjects(['add login', 'add login', 'fix signup'])
			expect(result).toBe('add login • fix signup')
		})
	})

	describe('buildBaseTitle', () => {
		let buildBaseTitle: typeof import('../git.js').buildBaseTitle

		beforeAll(async () => {
			const git = await import('../git.js')
			buildBaseTitle = git.buildBaseTitle
		})

		test('combines area and commit summary', () => {
			expect(buildBaseTitle('Update Src', 'add login')).toBe('Update Src: add login')
		})

		test('returns area only if no commits', () => {
			expect(buildBaseTitle('Update Src', undefined)).toBe('Update Src')
		})

		test('returns commit only if no area', () => {
			expect(buildBaseTitle(undefined, 'add login')).toBe('add login')
		})

		test('returns fallback', () => {
			expect(buildBaseTitle(undefined, undefined)).toBe('Update changes')
		})
	})

	describe('truncateDiff', () => {
		let truncateDiff: typeof import('../git.js').truncateDiff

		beforeAll(async () => {
			const git = await import('../git.js')
			truncateDiff = git.truncateDiff
		})

		test('returns original diff when under limit', () => {
			const diff = 'diff --git a/foo.ts b/foo.ts\n+hello'
			const result = truncateDiff(diff)
			expect(result.truncated).toBe(false)
			expect(result.diff).toBe(diff)
		})

		test('truncates large diff and reports omitted files', () => {
			const smallFile = 'diff --git a/small.ts b/small.ts\n' + 'x'.repeat(100) + '\n'
			const bigFile = 'diff --git a/big.ts b/big.ts\n' + 'x'.repeat(500) + '\n'
			const combined = smallFile + bigFile

			// Use a small maxChars to force truncation
			const result = truncateDiff(combined, 200)
			expect(result.truncated).toBe(true)
			expect(result.diff).toContain('[TRUNCATED')
		})
	})

	describe('readFileContent - path traversal protection', () => {
		let readFileContent: typeof import('../git.js').readFileContent

		beforeAll(async () => {
			const git = await import('../git.js')
			readFileContent = git.readFileContent
		})

		test('rejects absolute path outside repo', () => {
			expect(() => readFileContent('/etc/passwd')).toThrow('Access denied')
		})

		test('rejects relative path traversal', () => {
			expect(() => readFileContent('../../etc/passwd')).toThrow('Access denied')
		})

		test('reads file within repo', () => {
			// package.json exists in the repo root
			const content = readFileContent('package.json')
			expect(content).toContain('llmpr')
		})
	})
})

// ── config.ts tests ──

describe('config.ts', () => {
	describe('mergeConfigWithDefaults', () => {
		let mergeConfigWithDefaults: typeof import('../config.js').mergeConfigWithDefaults

		beforeAll(async () => {
			const config = await import('../config.js')
			mergeConfigWithDefaults = config.mergeConfigWithDefaults
		})

		const defaults = {
			base: 'main',
			model: 'gpt-5.1',
			style: 'standard',
			maxLength: '500',
			provider: 'openai',
			verbose: false,
		}

		const baseCli = {
			base: 'main',
			model: 'gpt-5.1',
			output: undefined,
			review: false,
			verbose: false,
			style: 'standard' as const,
			maxLength: '500',
			createPr: false,
			githubConfig: false,
			dryRun: false,
			provider: 'openai',
			template: undefined,
		}

		test('applies config values when CLI is at defaults', () => {
			const result = mergeConfigWithDefaults(baseCli, { base: 'develop', model: 'gpt-4o' }, defaults)
			expect(result.base).toBe('develop')
			expect(result.model).toBe('gpt-4o')
		})

		test('CLI overrides config', () => {
			const cliWithOverride = { ...baseCli, base: 'staging' }
			const result = mergeConfigWithDefaults(cliWithOverride, { base: 'develop' }, defaults)
			expect(result.base).toBe('staging')
		})

		test('returns CLI values when no config', () => {
			const result = mergeConfigWithDefaults(baseCli, {}, defaults)
			expect(result.base).toBe('main')
			expect(result.model).toBe('gpt-5.1')
		})
	})
})

// ── prompts.ts tests ──

describe('prompts.ts', () => {
	let buildPrDescriptionPrompt: typeof import('../prompts.js').buildPrDescriptionPrompt
	let buildReviewPrompt: typeof import('../prompts.js').buildReviewPrompt

	beforeAll(async () => {
		const promptsModule = await import('../prompts.js')
		buildPrDescriptionPrompt = promptsModule.buildPrDescriptionPrompt
		buildReviewPrompt = promptsModule.buildReviewPrompt
	})

	const baseOptions = {
		base: 'main',
		model: 'gpt-5.1',
		output: undefined,
		review: false,
		verbose: false,
		style: 'standard' as const,
		maxLength: '500',
		createPr: false,
		githubConfig: false,
		dryRun: false,
		provider: 'openai',
		template: undefined,
	}

	test('PR description prompt includes diff and structure', () => {
		const result = buildPrDescriptionPrompt('+ added line', 'src/', baseOptions)
		expect(result).toContain('+ added line')
		expect(result).toContain('src/')
		expect(result).toContain('NEED_CONTEXT')
	})

	test('concise style changes prompt content', () => {
		const result = buildPrDescriptionPrompt('diff', 'tree', { ...baseOptions, style: 'concise' })
		expect(result).toContain('concise')
		expect(result).toContain('focusing only on summary')
	})

	test('verbose style includes diagram instructions', () => {
		const result = buildPrDescriptionPrompt('diff', 'tree', { ...baseOptions, style: 'verbose' })
		expect(result).toContain('Mermaid diagrams')
	})

	test('review prompt has correct sections', () => {
		const result = buildReviewPrompt('diff', 'tree', baseOptions)
		expect(result).toContain('## Good')
		expect(result).toContain('## Bad')
		expect(result).toContain('## Suggestions')
		expect(result).toContain('## Critical Fixes')
	})

	test('review prompt respects max length', () => {
		const result = buildReviewPrompt('diff', 'tree', { ...baseOptions, maxLength: '200' })
		expect(result).toContain('200 words')
	})
})

// ── llm.ts tests ──

describe('llm.ts', () => {
	describe('createProvider', () => {
		let createProvider: typeof import('../llm.js').createProvider

		beforeAll(async () => {
			const llm = await import('../llm.js')
			createProvider = llm.createProvider
		})

		test('creates OpenAI provider with config', () => {
			const provider = createProvider('openai', { apiKey: 'test-key' })
			expect(provider.name).toBe('openai')
		})

		test('creates Anthropic provider with config', () => {
			const provider = createProvider('anthropic', { apiKey: 'test-key' })
			expect(provider.name).toBe('anthropic')
		})

		test('creates OpenAI-compatible provider with config', () => {
			const provider = createProvider('openai-compatible', { apiKey: 'test-key', baseUrl: 'http://localhost:11434/v1' })
			expect(provider.name).toBe('openai-compatible')
		})

		test('throws on unknown provider', () => {
			expect(() => createProvider('unknown', { apiKey: 'test' })).toThrow('Unknown provider')
		})
	})
})

// ── cli.ts tests ──

describe('cli.ts', () => {
	let parseArgs: typeof import('../cli.js').parseArgs

	beforeAll(async () => {
		const cli = await import('../cli.js')
		parseArgs = cli.parseArgs
	})

	test('parses default options', () => {
		const opts = parseArgs(['node', 'llmpr'])
		expect(opts.base).toBe('main')
		expect(opts.model).toBe('gpt-5.1')
		expect(opts.style).toBe('standard')
		expect(opts.provider).toBe('openai')
	})

	test('parses custom base branch', () => {
		const opts = parseArgs(['node', 'llmpr', '--base', 'develop'])
		expect(opts.base).toBe('develop')
	})

	test('parses provider flag', () => {
		const opts = parseArgs(['node', 'llmpr', '--provider', 'anthropic'])
		expect(opts.provider).toBe('anthropic')
	})

	test('parses dry-run flag', () => {
		const opts = parseArgs(['node', 'llmpr', '--dry-run'])
		expect(opts.dryRun).toBe(true)
	})

	test('parses review flag', () => {
		const opts = parseArgs(['node', 'llmpr', '-r'])
		expect(opts.review).toBe(true)
	})

	test('parses template option', () => {
		const opts = parseArgs(['node', 'llmpr', '--template', 'my-template.txt'])
		expect(opts.template).toBe('my-template.txt')
	})
})
