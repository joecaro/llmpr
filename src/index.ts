#!/usr/bin/env node

import { writeFileSync, readFileSync, realpathSync } from 'fs'
import { pathToFileURL, fileURLToPath } from 'url'
import { parseArgs, CLI_DEFAULTS } from './cli.js'
import { loadConfig, mergeConfigWithDefaults } from './config.js'
import { getGitDiff, getChangedFiles, getDirectoryStructure, truncateDiff } from './git.js'
import { sendPrompt, createProvider } from './llm.js'
import { buildPrDescriptionPrompt, buildReviewPrompt } from './prompts.js'
import { checkGhInstalled, checkGhAuth, checkRepoAccess, switchGhAccount, interactivePRCreation } from './github.js'
import { colors, logger } from './ui.js'
import type { CliOptions } from './types.js'
import ora from 'ora'
import prompts from 'prompts'

async function handleGithubConfig(options: CliOptions): Promise<void> {
	logger.info('Checking github config...')
	const ghInstalled = await checkGhInstalled()
	if (!ghInstalled) {
		logger.error('GitHub CLI (gh) is not installed')
		logger.info('Install it from: https://cli.github.com/')
		process.exit(1)
	}
	const authStatus = await checkGhAuth()
	if (options.verbose) {
		logger.box(authStatus.output || 'No output', 'GitHub Auth Status')
	}
	if (!authStatus.authenticated) {
		logger.error('You are not authenticated with GitHub CLI')
		logger.info('Run: gh auth login')
		process.exit(1)
	}
	logger.success(`Authenticated as ${colors.highlight(authStatus.activeAccount?.username || 'user')}`)

	let repoAccess = await checkRepoAccess()
	if (!repoAccess.hasAccess) {
		logger.warning(`Active account ${colors.highlight(authStatus.activeAccount?.username || 'unknown')} does not have repo access`)

		const accountChoices = authStatus.accounts.map(acc => ({
			title: `${acc.username}${acc.active ? ' (currently active)' : ''}`,
			value: acc.username,
			description: `Scopes: ${acc.scopes.slice(0, 3).join(', ')}${acc.scopes.length > 3 ? '...' : ''}`
		}))

		const selectResponse = await prompts({
			type: 'select',
			name: 'account',
			message: 'Select GitHub account to use for this PR:',
			choices: accountChoices,
			initial: authStatus.accounts.findIndex(acc => acc.active)
		})

		if (!selectResponse.account) {
			logger.warning('PR creation cancelled')
			process.exit(0)
		}

		if (selectResponse.account !== authStatus.activeAccount?.username) {
			const spinner = ora('Switching GitHub account...').start()
			const switched = await switchGhAccount(selectResponse.account)
			if (!switched) {
				spinner.fail('Failed to switch GitHub account')
				process.exit(1)
			}
			spinner.succeed(`Switched to ${colors.highlight(selectResponse.account)}`)
			repoAccess = await checkRepoAccess()
		}
	}

	const { getCurrentBranch } = await import('./git.js')
	const currentBranch = await getCurrentBranch()
	logger.info(`Current branch: ${colors.highlight(currentBranch)}`)
	process.exit(0)
}

export async function main(argv?: string[]) {
	const cliOptions = parseArgs(argv)
	const config = loadConfig()
	const options = mergeConfigWithDefaults(cliOptions, config, CLI_DEFAULTS)

	// Handle --github-config mode
	if (options.githubConfig) {
		await handleGithubConfig(options)
		return
	}

	try {
		if (options.verbose) {
			if (options.review) {
				logger.info(`Mode: ${colors.highlight('code review')}`)
			} else {
				logger.info(`PR style: ${colors.highlight(options.style)}`)
			}
			logger.info(`Max length: ${colors.highlight(options.maxLength)} words`)
			logger.info(`Provider: ${colors.highlight(options.provider)}`)
		}

		// Get diff and directory structure
		const rawDiff = await getGitDiff(options.base)
		if (rawDiff.trim() === '') {
			logger.warning(`No changes detected between your branch and ${colors.highlight(options.base)}.`)
			process.exit(0)
		}

		// Truncate if too large
		const { diff, truncated } = truncateDiff(rawDiff)
		if (truncated) {
			logger.warning('Diff is very large and has been truncated. Some files may be omitted from analysis.')
		}

		const changedFiles = await getChangedFiles(options.base)
		const dirStructure = getDirectoryStructure(process.cwd(), changedFiles)

		// Build the prompt - support custom template
		let initialPrompt: string
		if (options.template) {
			try {
				initialPrompt = readFileSync(options.template, 'utf8')
					.replace('{{diff}}', diff)
					.replace('{{dirStructure}}', dirStructure)
					.replace('{{style}}', options.style)
					.replace('{{maxLength}}', options.maxLength)
					.replace('{{base}}', options.base)
			} catch {
				logger.error(`Failed to read template file: ${options.template}`)
				process.exit(1)
			}
		} else {
			initialPrompt = options.review
				? buildReviewPrompt(diff, dirStructure, options)
				: buildPrDescriptionPrompt(diff, dirStructure, options)
		}

		const taskName = options.review ? 'code review' : 'PR description'

		// Dry run mode - show prompt without calling LLM
		if (options.dryRun) {
			logger.title('Dry Run - Prompt Preview')
			logger.info(`Provider: ${colors.highlight(options.provider)}`)
			logger.info(`Model: ${colors.highlight(options.model)}`)
			logger.info(`Prompt length: ${colors.highlight(initialPrompt.length.toString())} chars`)
			logger.divider()
			console.log(initialPrompt)
			logger.divider()
			logger.info('No API call was made (--dry-run mode)')
			return
		}

		// Create provider and send prompt
		const provider = createProvider(options.provider)
		const response = await sendPrompt(provider, initialPrompt, options, taskName)

		if (options.review) {
			if (options.createPr) {
				logger.warning('--create-pr flag is ignored when generating a review')
			}

			if (options.output) {
				writeFileSync(options.output, response)
				logger.success(`Code review saved to ${colors.highlight(options.output)}`)
				logger.info(`Use ${colors.highlight(`cat ${options.output}`)} to view the content`)
			} else {
				logger.divider()
				logger.title('AI Code Review')
				console.log(response)
				logger.divider()
				logger.info('Share this review with your team or use it to inform fixes')
			}
			return
		}

		// If --create-pr flag is set, start interactive PR creation
		if (options.createPr) {
			await interactivePRCreation(response, options)
		} else {
			if (options.output) {
				writeFileSync(options.output, response)
				logger.success(`PR description saved to ${colors.highlight(options.output)}`)
				logger.info(`Use ${colors.highlight(`cat ${options.output}`)} to view the content`)
			} else {
				logger.divider()
				logger.title('Generated PR Description')
				console.log(response)
				logger.divider()
				logger.info('Copy the text above for your PR description')
				logger.info(`Tip: Use ${colors.highlight('llmpr -o pr.md')} to save to a file next time`)
			}
		}
	} catch (error: unknown) {
		let errorMessage = 'An unknown error occurred'
		if (error instanceof Error) {
			errorMessage = error.message
		} else if (error !== null && error !== undefined) {
			errorMessage = String(error)
		}
		logger.error(errorMessage)
		process.exit(1)
	}
}

// ESM-compatible main module check (handles symlinks and path normalization)
function isMainModule(): boolean {
	const scriptPath = process.argv[1]
	if (!scriptPath) return false
	try {
		const modulePath = fileURLToPath(import.meta.url)
		const moduleReal = realpathSync(modulePath)
		const scriptReal = realpathSync(scriptPath)
		return moduleReal === scriptReal
	} catch {
		return pathToFileURL(scriptPath).href === import.meta.url
	}
}

if (isMainModule()) {
	logger.info('Starting LLMPR...')
	main().catch(error => {
		logger.error(`An error occurred: ${error.message}`)
		process.exit(1)
	})
}
