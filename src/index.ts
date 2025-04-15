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
	.option('-m, --model <model>', 'OpenAI model to use', 'gpt-4o')
	.option('-o, --output <file>', 'output file for PR description')
	.option('-v, --verbose', 'show detailed logs and API responses')
	.option('-s, --style <style>', 'PR description style (concise or verbose)', 'verbose')
	.option('-l, --max-length <words>', 'maximum length of PR description in words', '500')
	.addHelpText('after', `
Style options:
  - concise: Focus on summary, key details, and changes only
  - verbose: Include code snippets and diagrams where appropriate
`)
	.parse(process.argv)

// Remove the custom help text that always shows
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
3. Implementation details with relevant code snippets
4. Architecture diagrams using Mermaid if applicable
5. Any important notes, warnings, or future improvements`
	: `Include:
1. Summary of changes
2. Purpose of the PR
3. Key implementation details
4. Any important notes or warnings`
}

Your goal is to make a PR that is the gold standard of PRs and is very clear, explains the most important details, and assists with any engineer that reads it.

${options.style === 'verbose' 
	? `Make this PR stand out:
- Use before/after code snippet comparisons when showing important changes
- Create visual Mermaid diagrams that illustrate architecture changes or data flows
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
- Code blocks
- Links
- Bold and italic text
- Headings
- Quotes
${options.style === 'verbose' ? `- Mermaid diagrams
- Tables
- Emojis (sparingly)
- Collapsible sections for optional details` : ''}

${options.style === 'verbose' 
	? `For code snippets:
- Show the most important changes, not all changes
- Use diff syntax with + and - when showing before/after
- Focus on readable examples that demonstrate the key concepts
- Always include the language for proper syntax highlighting (e.g. \`\`\`typescript)

For diagrams:
- Use Mermaid diagrams to show architecture, workflows, or state changes
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
\`\`\``
	: ``}

*MAKE SURE NOT TO ADD ITEMS OR SECTIONS IF THEY ARE NOT NEEDED. I.E. A SIMPLE CHANGE DOESN'T NEED A DIAGRAM OR EXTENSIVE EXAMPLES*

If you need to see the contents of any specific file to better understand the changes, you can request it by including [NEED_CONTEXT:filepath] in your response. For example, [NEED_CONTEXT:src/config.ts]. You can request up to 3 files for additional context.
`
		// Send to OpenAI and get response
		const response = await sendPromptToOpenAI(initialPrompt)
		
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