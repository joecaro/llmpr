/**
 * CLI argument parsing with Commander - deferred (not parsed on import)
 */

import { Command } from 'commander'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import type { CliOptions } from './types.js'

// Get version from package.json
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const packageJsonPath = join(__dirname, '..', 'package.json')
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
const VERSION = packageJson.version

export const CLI_DEFAULTS: Record<string, unknown> = {
	base: 'main',
	model: 'gpt-5.1',
	style: 'standard',
	maxLength: '500',
	provider: 'openai',
	verbose: false,
	dryRun: false,
}

/**
 * Parse CLI arguments. Call this from main(), not at module load time.
 */
export function parseArgs(argv: string[] = process.argv): CliOptions {
	const program = new Command()
	program
		.version(VERSION)
		.option('-b, --base <branch>', 'base branch to compare against', 'main')
		.option('-m, --model <model>', 'LLM model to use', 'gpt-5.1')
		.option('-o, --output <file>', 'output file for PR description')
		.option('-r, --review', 'generate a structured code review instead of a PR description')
		.option('-v, --verbose', 'show detailed logs and API responses')
		.option('-s, --style <style>', 'PR description style (concise, standard, or verbose)', 'standard')
		.option('-l, --max-length <words>', 'maximum length of PR description in words', '500')
		.option('-c, --create-pr', 'create a GitHub PR after generating description')
		.option('-gh, --github-config', 'check github config', false)
		.option('-p, --provider <provider>', 'LLM provider (openai, anthropic, openai-compatible)', 'openai')
		.option('--dry-run', 'show what would be sent to the LLM without calling it')
		.option('-t, --template <file>', 'custom prompt template file')
		.addHelpText('after', `
Style options:
  - concise: Focus on summary, key details, and changes only
  - verbose: Include code snippets and diagrams where appropriate

Provider options:
  - openai: OpenAI API (requires OPENAI_API_KEY)
  - anthropic: Anthropic Claude API (requires ANTHROPIC_API_KEY)
  - openai-compatible: Any OpenAI-compatible endpoint (uses LLM_API_KEY, LLM_BASE_URL)

Commands:
  config    Set up provider and model defaults interactively
`)
		.parse(argv)

	return program.opts() as CliOptions
}
