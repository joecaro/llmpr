/**
 * GitHub CLI integration - auth, PR creation, repo access
 * All commands use execFile() to prevent shell injection.
 */

import { execFile } from 'child_process'
import ora from 'ora'
import prompts from 'prompts'
import { colors, logger } from './ui.js'
import { getCurrentBranch, pushBranchToRemote, resolveComparisonBase, getMergeBase, getChangedFiles, getCommitSubjects, summarizeChangedAreas, summarizeCommitSubjects, buildBaseTitle } from './git.js'
import { compressTitleWithLLM, createProvider } from './llm.js'
import type { GhAuthStatus, RepoAccess, CliOptions } from './types.js'

/**
 * Get clean env without GITHUB_TOKEN/GH_TOKEN so gh uses its stored credentials
 */
function cleanGhEnv(): NodeJS.ProcessEnv {
	const env = { ...process.env }
	delete env.GITHUB_TOKEN
	delete env.GH_TOKEN
	return env
}

/**
 * Check if gh CLI is installed
 */
export function checkGhInstalled(): Promise<boolean> {
	return new Promise((resolve) => {
		execFile('gh', ['--version'], (err) => {
			resolve(!err)
		})
	})
}

/**
 * Check if user is authenticated with gh CLI and get account info
 */
export function checkGhAuth(): Promise<GhAuthStatus> {
	return new Promise((resolve) => {
		execFile('gh', ['api', 'user', '-i'], { env: cleanGhEnv() }, (err, stdout, stderr) => {
			if (err) {
				const output = (stderr || err.message || '').trim()
				resolve({ authenticated: false, accounts: [], output })
				return
			}

			const rawOutput = stdout.trim()
			const firstBraceIndex = rawOutput.indexOf('{')

			if (firstBraceIndex === -1) {
				resolve({ authenticated: false, accounts: [], output: rawOutput })
				return
			}

			const headerBlock = rawOutput.slice(0, firstBraceIndex).trim()
			const jsonBlock = rawOutput.slice(firstBraceIndex).trim()

			try {
				const userData = JSON.parse(jsonBlock)
				const username: string = userData.login || 'unknown'

				const headerLines = headerBlock.split(/\r?\n/)
				const scopeLine = headerLines.find(line => line.toLowerCase().startsWith('x-oauth-scopes:'))
				const scopes = scopeLine
					? scopeLine.split(':')[1].split(',').map(scope => scope.trim()).filter(Boolean)
					: []

				const account = { username, active: true, scopes }

				resolve({
					authenticated: true,
					accounts: [account],
					activeAccount: account,
					output: rawOutput
				})
			} catch (parseError) {
				resolve({
					authenticated: false,
					accounts: [],
					output: `Failed to parse gh api response: ${(parseError as Error).message || parseError}`
				})
			}
		})
	})
}

/**
 * Switch the active GitHub account (uses execFile - no shell injection)
 */
export function switchGhAccount(username: string): Promise<boolean> {
	return new Promise((resolve) => {
		execFile('gh', ['auth', 'switch', '--user', username], { env: cleanGhEnv() }, (err, _stdout, stderr) => {
			if (err) {
				logger.error(`Failed to switch account: ${stderr || err.message}`)
				resolve(false)
				return
			}
			resolve(true)
		})
	})
}

/**
 * Check if user has push access to the repository
 */
export function checkRepoAccess(): Promise<RepoAccess> {
	return new Promise((resolve) => {
		execFile('gh', ['repo', 'view', '--json', 'nameWithOwner,viewerPermission'], { env: cleanGhEnv() }, (err, stdout) => {
			if (err) {
				resolve({ hasAccess: false })
				return
			}

			try {
				const data = JSON.parse(stdout)
				const permission = data.viewerPermission || 'NONE'
				const repoName = data.nameWithOwner
				const hasAccess = ['WRITE', 'ADMIN', 'MAINTAIN'].includes(permission)
				resolve({ hasAccess, repoName })
			} catch {
				resolve({ hasAccess: false })
			}
		})
	})
}

/**
 * Create a GitHub PR using gh CLI (safe - uses execFile + stdin for body)
 */
export async function createPullRequest(title: string, body: string, base: string, draft: boolean): Promise<string> {
	const spinner = ora({
		text: 'Creating pull request...',
		spinner: 'dots'
	}).start()

	return new Promise((resolve, reject) => {
		const args = ['pr', 'create', '--title', title, '--body-file', '-', '--base', base]
		if (draft) {
			args.push('--draft')
		}

		const child = execFile('gh', args, { env: cleanGhEnv() }, (err, stdout, stderr) => {
			if (err) {
				spinner.fail('Failed to create pull request')

				let errorMessage = stderr || err.message

				if (errorMessage.includes('must be a collaborator')) {
					errorMessage = 'You must be a collaborator with write access to create PRs in this repository.\n' +
						'Options:\n' +
						'  - Fork the repository and create a PR from your fork\n' +
						'  - Ask a repository admin to add you as a collaborator\n' +
						'  - Use llmpr without --create-pr to generate the description only'
				} else if (errorMessage.includes('already exists')) {
					errorMessage = 'A pull request already exists for this branch.\n' +
						'Use: gh pr view --web to see the existing PR'
				} else if (errorMessage.includes('No commits between')) {
					errorMessage = 'No commits found between base and head branch.\n' +
						'Make sure you have pushed commits to your branch'
				} else if (errorMessage.includes('not found')) {
					errorMessage = `Base branch "${base}" not found.\n` +
						'Check that the base branch name is correct'
				}

				reject(new Error(errorMessage))
				return
			}

			spinner.succeed('Pull request created successfully!')
			resolve(stdout.trim())
		})

		if (child.stdin) {
			child.stdin.write(body)
			child.stdin.end()
		}
	})
}

function requiresBranchPush(errorMessage: string): boolean {
	const normalized = errorMessage.toLowerCase()
	return normalized.includes('must first push') ||
		normalized.includes('--head flag') ||
		normalized.includes('set the remote') ||
		normalized.includes('no upstream')
}

/**
 * Get suggested PR title from recent commits
 */
export async function getSuggestedTitle(options: CliOptions): Promise<string> {
	const compareRef = await resolveComparisonBase(options.base)
	const mergeBase = await getMergeBase(compareRef)
	const commits = await getCommitSubjects(mergeBase)
	const changedFiles = await getChangedFiles(compareRef)

	if (commits.length === 0 && changedFiles.length === 0) {
		return 'Update changes'
	}

	const areaSummary = summarizeChangedAreas(changedFiles)
	const commitSummary = summarizeCommitSubjects(commits)
	const baseTitle = buildBaseTitle(areaSummary, commitSummary)

	try {
		const provider = createProvider(options.provider)
		const llmTitle = await compressTitleWithLLM(provider, baseTitle, changedFiles, options.model)
		return llmTitle || baseTitle || 'Update changes'
	} catch {
		return baseTitle || 'Update changes'
	}
}

/**
 * Interactive PR creation flow
 */
export async function interactivePRCreation(generatedDescription: string, options: CliOptions): Promise<void> {
	logger.divider()
	logger.title('PR Creation Flow')

	const ghInstalled = await checkGhInstalled()
	if (!ghInstalled) {
		logger.error('GitHub CLI (gh) is not installed')
		logger.info('Install it from: https://cli.github.com/')
		logger.info('Or run: brew install gh (on macOS)')
		process.exit(1)
	}

	const authStatus = await checkGhAuth()
	if (!authStatus.authenticated) {
		logger.error('You are not authenticated with GitHub CLI')
		logger.info('Run: gh auth login')
		process.exit(1)
	}

	logger.success(`Authenticated as ${colors.highlight(authStatus.activeAccount?.username || 'user')}`)

	// Check repo access, with account switching if needed
	let repoAccess = await checkRepoAccess()

	if (!repoAccess.hasAccess && authStatus.accounts.length > 1) {
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

	if (!repoAccess.hasAccess) {
		logger.error('You do not have permission to create pull requests in this repository')
		if (repoAccess.repoName) {
			logger.info(`Repository: ${colors.highlight(repoAccess.repoName)}`)
		}
		logger.info('Options:')
		logger.info('  1. Fork the repository and create a PR from your fork')
		logger.info('  2. Ask a repository admin to add you as a collaborator')
		logger.info('  3. Use llmpr without --create-pr to generate the description only')
		process.exit(1)
	}

	if (repoAccess.repoName) {
		logger.info(`Repository: ${colors.highlight(repoAccess.repoName)}`)
	}

	const currentBranch = await getCurrentBranch()
	logger.info(`Current branch: ${colors.highlight(currentBranch)}`)

	const suggestedTitle = await getSuggestedTitle(options)

	// Show generated description preview
	logger.divider()
	console.log(colors.subheading('Generated Description Preview'))
	const preview = generatedDescription.length > 200
		? generatedDescription.substring(0, 200) + '...'
		: generatedDescription
	console.log(colors.dim(preview))
	logger.divider()

	const response = await prompts([
		{
			type: 'text',
			name: 'title',
			message: 'PR Title:',
			initial: suggestedTitle,
			validate: (value: string) => value.trim().length > 0 ? true : 'Title cannot be empty'
		},
		{
			type: 'confirm',
			name: 'editDescription',
			message: 'Edit the generated description?',
			initial: false
		},
		{
			type: (prev: boolean) => prev ? 'text' : null,
			name: 'description',
			message: 'PR Description (leave empty to keep generated):',
			initial: generatedDescription,
			validate: (value: string) => value.trim().length > 0 ? true : 'Description cannot be empty'
		},
		{
			type: 'text',
			name: 'base',
			message: 'Base branch:',
			initial: options.base,
			validate: (value: string) => value.trim().length > 0 ? true : 'Base branch cannot be empty'
		},
		{
			type: 'confirm',
			name: 'draft',
			message: 'Create as draft PR?',
			initial: false
		},
		{
			type: 'confirm',
			name: 'confirm',
			message: 'Create pull request?',
			initial: true
		}
	])

	if (!response.confirm) {
		logger.warning('PR creation cancelled')
		return
	}

	const finalDescription = response.editDescription && response.description
		? response.description
		: generatedDescription

	let prUrl: string | undefined
	while (!prUrl) {
		try {
			prUrl = await createPullRequest(
				response.title,
				finalDescription,
				response.base,
				response.draft
			)
		} catch (error: unknown) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			if (requiresBranchPush(errorMessage)) {
				logger.warning('Current branch must be pushed before creating a PR.')
				const pushResponse = await prompts({
					type: 'confirm',
					name: 'push',
					message: `Push ${currentBranch} to origin now?`,
					initial: true
				})

				if (!pushResponse.push) {
					logger.warning('PR creation cancelled. Push your branch and rerun the command.')
					process.exit(1)
				}

				await pushBranchToRemote(currentBranch)
				continue
			}

			logger.error(`Failed to create PR: ${errorMessage}`)
			process.exit(1)
		}
	}

	logger.divider()
	logger.success('Pull Request Created!')
	logger.divider()

	logger.box(`
${colors.subheading('Title:')} ${response.title}

${colors.subheading('Base Branch:')} ${response.base}
${colors.subheading('Status:')} ${response.draft ? colors.warning('Draft') : colors.success('Ready for Review')}

${colors.subheading('URL:')} ${colors.secondary(prUrl)}
	`.trim(), 'PR Details')

	logger.info(`Open in browser: ${colors.highlight(prUrl)}`)
}
