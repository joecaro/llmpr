/**
 * Terminal UI helpers - colors, logger, spinners
 */

import chalk from 'chalk'
import boxen from 'boxen'
import figures from 'figures'

// Terminal colors and styles
export const colors = {
	primary: chalk.hex('#7C3AED'),
	secondary: chalk.hex('#60A5FA'),
	success: chalk.hex('#10B981'),
	warning: chalk.hex('#F59E0B'),
	error: chalk.hex('#EF4444'),
	info: chalk.hex('#6B7280'),
	heading: chalk.bold.hex('#7C3AED').underline,
	subheading: chalk.bold.hex('#60A5FA'),
	dim: chalk.dim,
	highlight: chalk.hex('#F472B6')
}

// Fancy logger
export const logger = {
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
