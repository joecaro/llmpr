#!/usr/bin/env node

import { exec } from 'child_process'
import { readdirSync, statSync, writeFileSync, readFileSync } from 'fs'
import path from 'path'
import axios from 'axios'
import { program } from 'commander'
import chalk from 'chalk'
import ora from 'ora'
import boxen from 'boxen'
import figures from 'figures'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import prompts from 'prompts'

// Get version from package.json
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const packageJsonPath = join(__dirname, '..', 'package.json')
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
const VERSION = packageJson.version

// Terminal colors and styles
const colors = {
	primary: chalk.hex('#7C3AED'), // Vibrant purple
	secondary: chalk.hex('#60A5FA'), // Bright blue
	success: chalk.hex('#10B981'), // Emerald green
	warning: chalk.hex('#F59E0B'), // Amber
	error: chalk.hex('#EF4444'), // Red
	info: chalk.hex('#6B7280'), // Gray
	heading: chalk.bold.hex('#7C3AED').underline,
	subheading: chalk.bold.hex('#60A5FA'),
	dim: chalk.dim,
	highlight: chalk.hex('#F472B6') // Pink
}

// Fancy logger
const logger = {
	clear: () => {
		process.stdout.write('\x1Bc')
	},
	title: (text: string) => {
		console.log('\n' + colors.heading(text) + '\n')
	},
	info: (text: string) => {
		console.log(colors.info(`${figures.info} ${text}`))
	},
	success: (text: string) => {
		console.log(colors.success(`${figures.tick} ${text}`))
	},
	warning: (text: string) => {
		console.log(colors.warning(`${figures.warning} ${text}`))
	},
	error: (text: string) => {
		console.log(colors.error(`${figures.cross} ${text}`))
	},
	step: (text: string) => {
		console.log(colors.secondary(`${figures.pointer} ${text}`))
	},
	box: (text: string, title?: string) => {
		console.log(boxen(text, {
			padding: 1,
			margin: 1,
			borderStyle: 'round',
			borderColor: 'magenta',
			title: title || undefined,
			titleAlignment: 'center'
		}))
	},
	code: (text: string) => {
		console.log('\n' + chalk.bgHex('#282A36').white(text) + '\n')
	},
	divider: () => {
		console.log(colors.dim('─'.repeat(process.stdout.columns || 80)))
	}
}

// Setup command line options
program
	.version(VERSION)
	.option('-b, --base <branch>', 'base branch to compare against', 'main')
	.option('-m, --model <model>', 'OpenAI model to use', 'gpt-5')
	.option('-o, --output <file>', 'output file for PR description')
	.option('-v, --verbose', 'show detailed logs and API responses')
	.option('-s, --style <style>', 'PR description style (concise, standard, or verbose)', 'standard')
	.option('-l, --max-length <words>', 'maximum length of PR description in words', '500')
	.option('-c, --create-pr', 'create a GitHub PR after generating description')
	.option('-gh, --github-config', 'check github config', false)
	.addHelpText('after', `
Style options:
  - concise: Focus on summary, key details, and changes only
  - verbose: Include code snippets and diagrams where appropriate
`)
	.parse(process.argv)

// Remove the custom help text that always shows
const options = program.opts()

if (options.githubConfig) {
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
		logger.info('Follow the prompts to authenticate with GitHub')
		process.exit(1)
	}
	logger.success(`Authenticated as ${colors.highlight(authStatus.activeAccount?.username || 'user')}`)
	let repoAccess = await checkRepoAccess()
	if (!repoAccess.hasAccess) {
		logger.warning(`Active account ${colors.highlight(authStatus.activeAccount?.username || 'unknown')} does not have repo access`)

		// Prompt user to select an account
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

		// Switch account if different from active
		if (selectResponse.account !== authStatus.activeAccount?.username) {
			const spinner = ora('Switching GitHub account...').start()
			const switched = await switchGhAccount(selectResponse.account)

			if (!switched) {
				spinner.fail('Failed to switch GitHub account')
				process.exit(1)
			}

			spinner.succeed(`Switched to ${colors.highlight(selectResponse.account)}`)

			// Re-check repo access with new account
			repoAccess = await checkRepoAccess()
		}
	}
	const currentBranch = await getCurrentBranch()
	logger.info(`Current branch: ${colors.highlight(currentBranch)}`)
	process.exit(0)
}

// Get API key from environment variable or prompt the user
export function getApiKey(): string {
	const apiKey = process.env.OPENAI_API_KEY
	if (!apiKey) {
		logger.error('OPENAI_API_KEY environment variable is not set')
		logger.info('Please set it using: export OPENAI_API_KEY=your_api_key')
		process.exit(1)
	}
	return apiKey
}

export function getGitDiff(): Promise<string> {
	const spinner = ora({
		text: `Getting diff against ${colors.highlight(options.base)}...`,
		spinner: 'dots'
	}).start()

	return new Promise((resolve, reject) => {
		exec(`git diff ${options.base}`, (err, stdout, stderr) => {
			if (err) {
				spinner.fail()
				// Wrap in an Error object so error.message is set
				reject(new Error(`Error getting git diff: ${stderr || err.message}`))
				return
			}
			spinner.succeed(`Diff against ${colors.highlight(options.base)} successfully retrieved`)
			resolve(stdout)
		})
	})
}

export function getChangedFiles(): Promise<string[]> {
	return new Promise((resolve, reject) => {
		exec(`git diff --name-only ${options.base}`, (err, stdout, stderr) => {
			if (err) {
				reject(new Error(`Error getting changed files: ${stderr || err.message}`))
				return
			}
			// Return list of changed file paths
			resolve(stdout.trim().split('\n').filter(line => line.trim() !== ''))
		})
	})
}

export function getDirectoryStructure(dir: string, changedFiles: string[] = []): string {
	const spinner = ora({
		text: 'Analyzing repository structure...',
		spinner: 'dots'
	}).start()
	
	try {
		// Extract the directories containing changed files
		const changedDirs = new Set<string>()
		
		changedFiles.forEach(file => {
			// Add all parent directories
			let parentDir = path.dirname(file)
			while (parentDir !== '.') {
				changedDirs.add(parentDir)
				parentDir = path.dirname(parentDir)
			}
			// Add root directory as well
			changedDirs.add('.')
		})
		
		const formatTree = (currentPath: string, prefix = '', depth = 0, maxDepth = 3): string => {
			if (depth > maxDepth) {
				return `${prefix}... (more items not shown)\n`
			}
			
			const items = readdirSync(currentPath)
				.filter(item => {
					if (item.startsWith('.git')) return false // Skip .git directory
					
					const itemPath = path.join(currentPath, item)
					const relativePath = path.relative(dir, itemPath)
					const isDir = statSync(itemPath).isDirectory()
					
					// Include item if:
					// 1. It's a changed file, or
					// 2. It's a directory containing changed files
					// 3. We're at depth 0 (root level files/folders are always shown)
					if (isDir) {
						return changedDirs.has(relativePath) || depth === 0
					} else {
						return changedFiles.includes(relativePath) || depth === 0
					}
				})
				.sort((a, b) => {
					// Sort directories first, then files
					const aIsDir = statSync(path.join(currentPath, a)).isDirectory()
					const bIsDir = statSync(path.join(currentPath, b)).isDirectory()
					if (aIsDir && !bIsDir) return -1
					if (!aIsDir && bIsDir) return 1
					return a.localeCompare(b)
				})

			let result = ''
			
			items.forEach((item, index) => {
				const isLast = index === items.length - 1
				const itemPath = path.join(currentPath, item)
				const isDir = statSync(itemPath).isDirectory()
				
				// Use '└── ' for the last item, '├── ' for others
				const connector = isLast ? '└── ' : '├── '
				
				// Add folder/file indicator
				const displayName = isDir ? `${item}/` : item
				
				// Highlight changed files
				const relativePath = path.relative(dir, itemPath)
				const isChanged = !isDir && changedFiles.includes(relativePath)
				const formattedName = isChanged ? colors.highlight(displayName) : displayName
				
				result += `${prefix}${connector}${formattedName}\n`
				
				// Recursively process subdirectories
				if (isDir) {
					// For children of this item, add appropriate prefix
					// '    ' for children of last item, '│   ' for others
					const newPrefix = prefix + (isLast ? '    ' : '│   ')
					result += formatTree(itemPath, newPrefix, depth + 1, maxDepth)
				}
			})
			
			return result
		}
		
		// Get the base directory name
		const rootDir = path.basename(dir)
		
		// Start with the root directory
		let treeOutput = `${rootDir}/\n`
		
		// Add the tree structure
		treeOutput += formatTree(dir)
		
		spinner.succeed('Repository structure analyzed')
		return treeOutput
	} catch (error) {
		spinner.fail('Failed to analyze repository structure')
		throw error
	}
}

export async function sendPromptToOpenAI(prompt: string): Promise<string> {
	const apiKey = getApiKey()
	const spinner = ora({
		text: `Generating PR description using ${colors.highlight(options.model)}...`,
		spinner: 'dots'
	}).start()

	try {
		// Log the request if verbose
		if (options.verbose) {
			spinner.stop()
			logger.title('API Request')
			logger.box(prompt, 'Prompt')
			spinner.start()
		}

		// First round - send initial prompt
		const startTime = Date.now()
		let response = await callOpenAI(apiKey, prompt)
		let content = response.data.choices[0].message.content.trim()
		
		// Check if the LLM is requesting more context
		const maxRounds = 3
		let currentRound = 1
		
		while (currentRound < maxRounds) {
			// Look for file context requests in the format: [NEED_CONTEXT:filepath]
			const contextRequests = [...content.matchAll(/\[NEED_CONTEXT:([^\]]+)\]/g)]
			
			if (contextRequests.length === 0) {
				break // No more context needed
			}

			if (options.verbose) {
				const requestedFiles = contextRequests.map(match => match[1].trim())
				logger.info(`AI requested additional context for files (round ${currentRound + 1}): ${requestedFiles.join(', ')}`)
			}
			
			spinner.text = `Round ${currentRound + 1}/${maxRounds}: Fetching additional context...`
			
			// Process all context requests
			const additionalContext = await Promise.all(
				contextRequests.map(async match => {
					const filepath = match[1].trim()
					try {
						const fileContent = await readFileContent(filepath)
						return `File content for ${filepath}:\n\`\`\`\n${fileContent}\n\`\`\``
					} catch (error: unknown) {
						const errorMessage = error instanceof Error ? error.message : String(error)
						return `Error reading ${filepath}: ${errorMessage}`
					}
				})
			)
			
			// Build follow-up prompt
			const followUpPrompt = `
You previously requested additional context to complete the PR description.
Here is the requested context:

${additionalContext.join('\n\n')}

Based on this additional information, please generate the complete PR description as requested originally.
Do NOT request more context with [NEED_CONTEXT:filepath]. This is your final opportunity to generate the PR description.
`
			
			// Send follow-up request
			spinner.text = `Round ${currentRound + 1}/${maxRounds}: Generating improved PR description...`
			response = await callOpenAI(apiKey, followUpPrompt, [
				{ role: 'system', content: prompt },
				{ role: 'assistant', content: content }
			])
			
			// Update content with the new response
			content = response.data.choices[0].message.content.trim()
			currentRound++
		}
		
		const endTime = Date.now()
		const duration = ((endTime - startTime) / 1000).toFixed(2)

		spinner.succeed(`PR description generated in ${colors.highlight(duration + 's')} after ${currentRound} round${currentRound === 1 ? '' : 's'}`)

		// Log the response if verbose
		if (options.verbose) {
			logger.title('API Response')
			logger.info(`Model: ${colors.highlight(options.model)}`)
			logger.info(`Rounds of context: ${colors.highlight(currentRound.toString())}`)
			logger.info(`Duration: ${colors.highlight(duration + 's')}`)
		}

		// Extract content and strip markdown code block delimiters if present
		// Remove any remaining [NEED_CONTEXT:...] tags that weren't processed
		content = content.replace(/\[NEED_CONTEXT:[^\]]+\]/g, '')
		
		// Remove markdown code block syntax if it exists
		if (content.startsWith('```') && content.includes('\n')) {
			const lines = content.split('\n')
			if (lines[0].startsWith('```') && lines[lines.length - 1] === '```') {
				// Remove first and last lines if they're backticks
				content = lines.slice(1, lines.length - 1).join('\n')
			} else if (lines[0].startsWith('```')) {
				// Find the ending backticks
				const endIndex = lines.findIndex((line: string, i: number) => i > 0 && line === '```')
				if (endIndex !== -1) {
					content = lines.slice(1, endIndex).join('\n')
				}
			}
		}
		
		return content
	} catch (error: unknown) {
		spinner.fail('Failed to generate PR description')
		let errorMessage = 'Unknown error'
		
		if (error instanceof Error) {
			errorMessage = error.message
		} else if (error && typeof error === 'object') {
			// Try to handle axios error structure
			const axiosError = error as any
			if (axiosError.response?.data?.error?.message) {
				errorMessage = axiosError.response.data.error.message
			}
		} else {
			errorMessage = String(error)
		}
		
		throw new Error(`OpenAI API Error: ${errorMessage}`)
	}
}

/**
 * Helper function to call the OpenAI API
 */
async function callOpenAI(apiKey: string, content: string, previousMessages: any[] = []): Promise<any> {
	// Construct messages array
	const messages = previousMessages.length > 0 
		? [...previousMessages, { role: 'user', content }]
		: [{ role: 'system', content }]
	
	return axios.post(
		'https://api.openai.com/v1/chat/completions',
		{
			model: options.model,
			messages
		},
		{
			headers: { 'Authorization': `Bearer ${apiKey}` }
		}
	)
}

/**
 * Read file content safely
 */
async function readFileContent(filepath: string): Promise<string> {
	// Ensure the filepath is relative to the workspace
	const fullPath = path.isAbsolute(filepath)
		? filepath
		: path.join(process.cwd(), filepath)

	// Check if file exists
	if (!statSync(fullPath, { throwIfNoEntry: false })) {
		throw new Error(`File not found: ${filepath}`)
	}

	// Read the file
	return readFileSync(fullPath, 'utf8')
}

/**
 * Check if gh CLI is installed
 */
export function checkGhInstalled(): Promise<boolean> {
	return new Promise((resolve) => {
		exec('gh --version', (err) => {
			resolve(!err)
		})
	})
}

/**
 * GitHub account information
 */
interface GhAccount {
	username: string
	active: boolean
	scopes: string[]
}

/**
 * Check if user is authenticated with gh CLI and get all accounts
 */
export function checkGhAuth(): Promise<{ authenticated: boolean; accounts: GhAccount[]; activeAccount?: GhAccount; output?: string }> {
	return new Promise((resolve) => {
		// Temporarily unset GITHUB_TOKEN to get actual gh CLI auth status
		const env = { ...process.env }
		delete env.GITHUB_TOKEN
		delete env.GH_TOKEN

		exec('gh auth status', { env }, (err, stdout, stderr) => {
			// gh auth status returns info on stderr even on success
			const output = stderr + stdout

			if (err || !output.includes('Logged in')) {
				resolve({ authenticated: false, accounts: [], output: output })
				return
			}

			// Parse all accounts
			const accounts: GhAccount[] = []

			// Match all account usernames first
			const accountRegex = /✓ Logged in to github\.com account ([^\s(]+)/g
			const matches = Array.from(output.matchAll(accountRegex))

			for (let i = 0; i < matches.length; i++) {
				const match = matches[i]
				const username = match[1].trim()

				// Find the content for this account (from this match to the next match or end)
				const startIndex = match.index || 0
				const nextMatch = matches[i + 1]
				const endIndex = nextMatch ? (nextMatch.index || output.length) : output.length

				const accountBlock = output.substring(startIndex, endIndex)

				// Check if active
				const activeMatch = accountBlock.match(/Active account:\s*(true|false)/)
				const isActive = activeMatch ? activeMatch[1] === 'true' : false

				// Extract token scopes
				const scopesMatch = accountBlock.match(/Token scopes:\s*([^\n]+)/)
				const scopes: string[] = []
				if (scopesMatch) {
					const scopesStr = scopesMatch[1].replace(/'/g, '').trim()
					scopes.push(...scopesStr.split(',').map(s => s.trim()))
				}

				accounts.push({ username, active: isActive, scopes })
			}

			if (accounts.length === 0) {
				resolve({ authenticated: false, accounts: [], output: output })
				return
			}

			const activeAccount = accounts.find(acc => acc.active)

			if (options.verbose) {
				logger.info(`Parsed ${accounts.length} accounts:`)
				accounts.forEach(acc => {
					logger.info(`  - ${acc.username} (${acc.active ? 'active' : 'inactive'}) - Scopes: ${acc.scopes.join(', ')}`)
				})
			}

			resolve({
				authenticated: true,
				accounts,
				activeAccount,
				output: output
			})
		})
	})
}

/**
 * Switch the active GitHub account
 */
export function switchGhAccount(username: string): Promise<boolean> {
	return new Promise((resolve) => {
		// Temporarily unset GITHUB_TOKEN to allow gh CLI to manage auth
		const env = { ...process.env }
		delete env.GITHUB_TOKEN
		delete env.GH_TOKEN

		exec(`gh auth switch --user ${username}`, { env }, (err, _stdout, stderr) => {
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
export function checkRepoAccess(): Promise<{ hasAccess: boolean; repoName?: string }> {
	return new Promise((resolve) => {
		// Temporarily unset GITHUB_TOKEN to use gh CLI managed auth
		const env = { ...process.env }
		delete env.GITHUB_TOKEN
		delete env.GH_TOKEN

		exec('gh repo view --json nameWithOwner,viewerPermission', { env }, (err, stdout) => {
			if (err) {
				resolve({ hasAccess: false })
				return
			}

			try {
				const data = JSON.parse(stdout)
				const permission = data.viewerPermission || 'NONE'
				const repoName = data.nameWithOwner

				// Check if user has write/admin/maintain access
				const hasAccess = ['WRITE', 'ADMIN', 'MAINTAIN'].includes(permission)

				resolve({ hasAccess, repoName })
			} catch {
				resolve({ hasAccess: false })
			}
		})
	})
}

/**
 * Get current branch name
 */
export function getCurrentBranch(): Promise<string> {
	return new Promise((resolve, reject) => {
		exec('git branch --show-current', (err, stdout, stderr) => {
			if (err) {
				reject(new Error(`Error getting current branch: ${stderr || err.message}`))
				return
			}
			resolve(stdout.trim())
		})
	})
}

/**
 * Get suggested PR title from recent commits
 */
export function getSuggestedTitle(): Promise<string> {
	return new Promise((resolve, reject) => {
		exec(`git log ${options.base}..HEAD --pretty=format:"%s" --no-merges`, (err, stdout, stderr) => {
			if (err) {
				reject(new Error(`Error getting commit messages: ${stderr || err.message}`))
				return
			}

			const commits = stdout.trim().split('\n').filter(line => line.trim() !== '')

			if (commits.length === 0) {
				resolve('Update changes')
				return
			}

			// If only one commit, use its message
			if (commits.length === 1) {
				resolve(commits[0])
				return
			}

			// If multiple commits, try to find a common theme or use the first one
			resolve(commits[0])
		})
	})
}

/**
 * Create a GitHub PR using gh CLI
 */
export async function createPullRequest(title: string, body: string, base: string, draft: boolean): Promise<string> {
	const spinner = ora({
		text: 'Creating pull request...',
		spinner: 'dots'
	}).start()

	return new Promise((resolve, reject) => {
		// Build the gh pr create command
		const draftFlag = draft ? '--draft' : ''
		const command = `gh pr create --title "${title.replace(/"/g, '\\"')}" --body-file - --base ${base} ${draftFlag}`

		// Temporarily unset GITHUB_TOKEN to use gh CLI managed auth
		const env = { ...process.env }
		delete env.GITHUB_TOKEN
		delete env.GH_TOKEN

		const child = exec(command, { env }, (err, stdout, stderr) => {
			if (err) {
				spinner.fail('Failed to create pull request')

				// Parse error message for common issues
				let errorMessage = stderr || err.message

				if (errorMessage.includes('must be a collaborator')) {
					errorMessage = 'You must be a collaborator with write access to create PRs in this repository.\n' +
						'Options:\n' +
						'  • Fork the repository and create a PR from your fork\n' +
						'  • Ask a repository admin to add you as a collaborator\n' +
						'  • Use llmpr without --create-pr to generate the description only'
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

			// Extract PR URL from output
			const prUrl = stdout.trim()
			resolve(prUrl)
		})

		// Write the PR body to stdin
		if (child.stdin) {
			child.stdin.write(body)
			child.stdin.end()
		}
	})
}

/**
 * Interactive PR creation flow
 */
export async function interactivePRCreation(generatedDescription: string): Promise<void> {
	logger.divider()
	logger.title('PR Creation Flow')

	// Check if gh CLI is installed
	const ghInstalled = await checkGhInstalled()
	if (!ghInstalled) {
		logger.error('GitHub CLI (gh) is not installed')
		logger.info('Install it from: https://cli.github.com/')
		logger.info('Or run: brew install gh (on macOS)')
		process.exit(1)
	}

	// Check if user is authenticated
	let authStatus = await checkGhAuth()
	if (!authStatus.authenticated) {
		logger.error('You are not authenticated with GitHub CLI')
		logger.info('Run: gh auth login')
		logger.info('Follow the prompts to authenticate with GitHub')
		process.exit(1)
	}

	logger.success(`Authenticated as ${colors.highlight(authStatus.activeAccount?.username || 'user')}`)

	// Handle multiple accounts
	if (authStatus.accounts.length > 1) {
		logger.info(`Found ${authStatus.accounts.length} GitHub accounts`)

		// Show all accounts
		authStatus.accounts.forEach(acc => {
			const status = acc.active ? colors.success('active') : colors.dim('inactive')
			logger.info(`  - ${acc.username} (${status})`)
		})

		// Check repo access with current active account first
		let repoAccess = await checkRepoAccess()

		// If active account doesn't have access, offer to switch
		if (!repoAccess.hasAccess) {
			logger.warning(`Active account ${colors.highlight(authStatus.activeAccount?.username || 'unknown')} does not have repo access`)

			// Prompt user to select an account
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

			// Switch account if different from active
			if (selectResponse.account !== authStatus.activeAccount?.username) {
				const spinner = ora('Switching GitHub account...').start()
				const switched = await switchGhAccount(selectResponse.account)

				if (!switched) {
					spinner.fail('Failed to switch GitHub account')
					process.exit(1)
				}

				spinner.succeed(`Switched to ${colors.highlight(selectResponse.account)}`)

				// Re-check repo access with new account
				repoAccess = await checkRepoAccess()
			}

			// Final check after potential switch
			if (!repoAccess.hasAccess) {
				logger.error('Selected account does not have permission to create pull requests')
				if (repoAccess.repoName) {
					logger.info(`Repository: ${colors.highlight(repoAccess.repoName)}`)
				}
				logger.info('Options:')
				logger.info('  1. Fork the repository and create a PR from your fork')
				logger.info('  2. Ask a repository admin to add you as a collaborator')
				logger.info('  3. Use llmpr without --create-pr to generate the description only')
				process.exit(1)
			}
		}

		if (repoAccess.repoName) {
			logger.info(`Repository: ${colors.highlight(repoAccess.repoName)}`)
		}
	} else {
		// Single account - check repository access
		const repoAccess = await checkRepoAccess()
		if (!repoAccess.hasAccess) {
			logger.error('You do not have permission to create pull requests in this repository')
			if (repoAccess.repoName) {
				logger.info(`Repository: ${colors.highlight(repoAccess.repoName)}`)
			}
			logger.info('You need to be a collaborator with write access to create PRs')
			logger.info('Options:')
			logger.info('  1. Fork the repository and create a PR from your fork')
			logger.info('  2. Ask a repository admin to add you as a collaborator')
			logger.info('  3. Use llmpr without --create-pr to generate the description, then create PR manual ly')
			process.exit(1)
		}

		if (repoAccess.repoName) {
			logger.info(`Repository: ${colors.highlight(repoAccess.repoName)}`)
		}
	}

	// Get current branch
	const currentBranch = await getCurrentBranch()
	logger.info(`Current branch: ${colors.highlight(currentBranch)}`)

	// Get suggested title
	const suggestedTitle = await getSuggestedTitle()

	// Show generated description preview
	logger.divider()
	console.log(colors.subheading('Generated Description Preview'))
	const preview = generatedDescription.length > 200
		? generatedDescription.substring(0, 200) + '...'
		: generatedDescription
	console.log(colors.dim(preview))
	logger.divider()

	// Interactive prompts
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

	// Handle user cancellation
	if (!response.confirm) {
		logger.warning('PR creation cancelled')
		return
	}

	// Use edited description if provided, otherwise use generated
	const finalDescription = response.editDescription && response.description
		? response.description
		: generatedDescription

	// Create the PR
	try {
		const prUrl = await createPullRequest(
			response.title,
			finalDescription,
			response.base,
			response.draft
		)

		// Display success with PR details
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
	} catch (error: unknown) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		logger.error(`Failed to create PR: ${errorMessage}`)
		process.exit(1)
	}
}

export async function main() {
	try {
		// Display options if verbose mode is enabled
		if (options.verbose) {
			logger.info(`PR style: ${colors.highlight(options.style)}`)
			logger.info(`Max length: ${colors.highlight(options.maxLength)} words`)
		}

		// Get diff and directory structure
		const diff = await getGitDiff()
		if (diff.trim() === '') {
			logger.warning('No changes detected. Make sure you have uncommitted changes.')
			process.exit(0)
		}

		// Get list of changed files from git
		const changedFiles = await getChangedFiles()
		
		// Get directory structure, focusing on changed directories
		const dirStructure = getDirectoryStructure(process.cwd(), changedFiles)

		// Build the prompt
		const initialPrompt = `
You are an assistant that helps write PR descriptions.
The diff from my branch compared to ${options.base} is:
${diff}

The repository structure is:
\`\`\`
${dirStructure}
\`\`\`

Write a ${options.style} PR description${options.style === 'concise' ? ' focusing only on summary, key details, and changes' : ' including code snippets and diagrams where appropriate'}.

${options.style === 'verbose' 
	? `Include:
1. Detailed summary of changes
2. Purpose and motivation for the PR
3. Implementation details (include code snippets or diagrams ONLY if they are necessary to clearly explain complex or important changes)
4. Any important notes, warnings, or future improvements` 
	: `Include:
1. Summary of changes
2. Purpose of the PR
3. Key implementation details
4. Any important notes or warnings`}

Your goal is to make a PR that is the gold standard of PRs and is very clear, explains the most important details, and assists with any engineer that reads it.

${options.style === 'verbose' 
	? `Make this PR stand out:
- Use before/after code snippet comparisons ONLY when they are needed to clarify important changes
- Create visual Mermaid diagrams ONLY if they are necessary to explain architecture changes or data flows
- Highlight key technical decisions and explain the reasoning behind them
- Use clear, engaging section headers
- Format code examples with proper syntax highlighting
- Explain complex changes in simple terms, then follow with technical details
- Use tables to compare features or parameters when appropriate
- Link related concepts together for better understanding
- Start with a concise but powerful executive summary that captures the essence of the changes
- Use visual separation (horizontal rules, headings) to organize sections logically`
	: ``}

The PR description should be in markdown format.

The PR description should be no more than ${options.maxLength} words.

You can use markdown formatting including:
- Lists
- Code blocks (only if needed)
- Links
- Bold and italic text
- Headings
- Quotes
${options.style === 'verbose' ? `- Mermaid diagrams (only if needed)
- Tables
- Emojis (sparingly)
- Collapsible sections for optional details` : ''}

${options.style === 'verbose' 
	? `For code snippets:
- Only include code snippets if they are necessary to explain a complex or important change
- Show the most important changes, not all changes
- Use diff syntax with + and - when showing before/after
- Focus on readable examples that demonstrate the key concepts
- Always include the language for proper syntax highlighting (e.g. typescript)

For diagrams:
- Only include diagrams if they are necessary to explain architecture, workflows, or state changes
- Keep diagrams focused on the changes being made
- Use colors and styles to highlight important components
- Include a brief explanation of what the diagram shows

Example high-quality Mermaid diagram (if applicable):
\`\`\`mermaid
flowchart TD
    A[Client] -->|API Request| B(API Gateway)
    B -->|Route Request| C{Auth Service}
    C -->|Validate| D[User Service]
    C -->|Token| E[Permission Service]
    B -->|Authorized Request| F[Feature Service]
    style A fill:#f9f,stroke:#333,stroke-width:2px
    style F fill:#bbf,stroke:#33f,stroke-width:4px
\`\`\`

Example high-quality code snippet (if applicable):
\`\`\`typescript
// BEFORE: Inefficient implementation
function processData(items: Item[]): Result[] {
  const results: Result[] = [];
  for (const item of items) {
    // Process each item sequentially with multiple operations
    const temp = transform(item);
    const validated = validate(temp);
    results.push(finalize(validated));
  }
  return results;
}

// AFTER: Optimized implementation with better error handling
function processData(items: Item[]): Result[] {
  return items
    .map(transform)
    .filter(item => {
      try {
        return validate(item);
      } catch (error) {
        logger.warn(\`Invalid item: \${item.id}\`, error);
        return false;
      }
    })
    .map(finalize);
}
\`\`\`
`
: ''}

*MAKE SURE NOT TO ADD ITEMS OR SECTIONS IF THEY ARE NOT NEEDED. I.E. A SIMPLE CHANGE DOESN'T NEED A DIAGRAM OR EXTENSIVE EXAMPLES. ONLY INCLUDE DIAGRAMS OR CODE SNIPPETS IF THEY ARE NECESSARY TO EXPLAIN THE CHANGES.*

If you need to see the contents of any specific file to better understand the changes, you can request it by including [NEED_CONTEXT:filepath] in your response. For example, [NEED_CONTEXT:src/config.ts]. You can request up to 3 files for additional context.`;
		// Send to OpenAI and get response
		const response = await sendPromptToOpenAI(initialPrompt)

		// If --create-pr flag is set, start interactive PR creation
		if (options.createPr) {
			await interactivePRCreation(response)
		} else {
			// Display or save the result
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

// Check if this is the main module - ESM compatible check
// In ESM modules, import.meta.url is available
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1].endsWith(process.argv[1])) {
	logger.info('Starting LLMPR...')
	main().catch(error => {
		logger.error(`An error occurred: ${error.message}`)
		process.exit(1)
	})
} 