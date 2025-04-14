#!/usr/bin/env node

import { exec } from 'child_process'
import { readdirSync, statSync, writeFileSync } from 'fs'
import path from 'path'
import axios from 'axios'
import { program } from 'commander'
import chalk from 'chalk'
import ora from 'ora'
import boxen from 'boxen'
import figures from 'figures'

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
	.version('1.0.0')
	.option('-b, --base <branch>', 'base branch to compare against', 'main')
	.option('-m, --model <model>', 'OpenAI model to use', 'gpt-4o-mini')
	.option('-o, --output <file>', 'output file for PR description')
	.option('-v, --verbose', 'show detailed logs and API responses')
	.option('-s, --silent', 'minimize output, show only the final result')
	.parse(process.argv)

const options = program.opts()

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

export function getDirectoryStructure(dir: string): Array<{ name: string, isDir: boolean }> {
	const spinner = ora({
		text: 'Analyzing repository structure...',
		spinner: 'dots'
	}).start()
	
	try {
		const structure = readdirSync(dir).map(file => {
			const fullPath = path.join(dir, file)
			return { name: file, isDir: statSync(fullPath).isDirectory() }
		})
		spinner.succeed('Repository structure analyzed')
		return structure
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

		const startTime = Date.now()
		const response = await axios.post(
			'https://api.openai.com/v1/chat/completions',
			{
				model: options.model,
				messages: [{ role: 'system', content: prompt }]
			},
			{
				headers: { 'Authorization': `Bearer ${apiKey}` }
			}
		)
		const endTime = Date.now()
		const duration = ((endTime - startTime) / 1000).toFixed(2)

		spinner.succeed(`PR description generated in ${colors.highlight(duration + 's')}`)

		// Log the response if verbose
		if (options.verbose) {
			logger.title('API Response')
			logger.info(`Model: ${colors.highlight(options.model)}`)
			logger.info(`Prompt tokens: ${colors.highlight(response.data.usage?.prompt_tokens?.toString() || 'unknown')}`)
			logger.info(`Completion tokens: ${colors.highlight(response.data.usage?.completion_tokens?.toString() || 'unknown')}`)
			logger.info(`Total tokens: ${colors.highlight(response.data.usage?.total_tokens?.toString() || 'unknown')}`)
			logger.info(`Duration: ${colors.highlight(duration + 's')}`)
		}

		// Extract content and strip markdown code block delimiters if present
		let content = response.data.choices[0].message.content.trim()
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
	} catch (error: any) {
		spinner.fail('Failed to generate PR description')
		throw new Error(`OpenAI API Error: ${error.response?.data?.error?.message || error.message}`)
	}
}

export async function main() {
	try {
		// Clear console and show banner
		if (!options.silent) {
			logger.clear()
			logger.box(colors.primary.bold('LLMPR') + '\n' + colors.info('AI-powered PR descriptions'), 'v1.0.2')
		}

		// Get diff and directory structure
		const diff = await getGitDiff()
		if (diff.trim() === '') {
			logger.warning('No changes detected. Make sure you have uncommitted changes.')
			process.exit(0)
		}

		const dirStructure = getDirectoryStructure(process.cwd())

		// Build the prompt
		const initialPrompt = `
You are an assistant that helps write PR descriptions.
The diff from my branch compared to ${options.base} is:
${diff}

The repository structure is:
${JSON.stringify(dirStructure, null, 2)}

Write a complete, concise, and professional PR description including:
1. Summary of changes
2. Purpose of the PR
3. Key implementation details
4. Any important notes or warnings

The PR description should be in markdown format.

The PR description should be no more than 100 words.

You can use markdown formatting including:
- Lists
- Code blocks
- Links
- Bold and italic text
- Headings
- Quotes
- Mermaid diagrams if applicable and if it would be very helpful
`
		// Send to OpenAI and get response
		const response = await sendPromptToOpenAI(initialPrompt)
		
		// Display or save the result
		if (options.output) {
			writeFileSync(options.output, response)
			logger.success(`PR description saved to ${colors.highlight(options.output)}`)
			
			if (!options.silent) {
				logger.info(`Use ${colors.highlight(`cat ${options.output}`)} to view the content`)
			}
		} else {
			logger.divider()
			logger.title('Generated PR Description')
			console.log(response)
			logger.divider()
			
			if (!options.silent) {
				logger.info('Copy the text above for your PR description')
				logger.info(`Tip: Use ${colors.highlight('llmpr -o pr.md')} to save to a file next time`)
			}
		}
	} catch (error: any) {
		logger.error(error.message || 'An unknown error occurred')
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