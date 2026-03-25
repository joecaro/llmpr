/**
 * Git operations - diff, merge-base, branch, push, directory structure
 * All commands use execFile() with array args to prevent shell injection.
 */

import { execFile } from 'child_process'
import { readdirSync, statSync, readFileSync } from 'fs'
import path from 'path'
import ora from 'ora'
import { colors, logger } from './ui.js'

/**
 * Run a git command safely using execFile (no shell interpolation)
 */
function gitExec(args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile('git', args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
			if (err) {
				reject(new Error(stderr?.trim() || err.message))
				return
			}
			resolve(stdout)
		})
	})
}

/**
 * Resolve which ref to use when comparing against a base branch.
 *
 * If you pass `main` but local `main` is behind (never pulled), `merge-base(main, HEAD)` can be
 * an old ancestor. Then `diff merge-base..HEAD` incorrectly includes commits that only exist on
 * the remote default branch. Preferring `origin/<name>` when present matches what GitHub uses for
 * PRs after a fetch.
 *
 * Use an explicit `origin/main` (or `refs/heads/main`) when you need to override this.
 */
export async function resolveComparisonBase(baseBranch: string): Promise<string> {
	const tryRefs: string[] = []

	if (baseBranch.startsWith('origin/') || baseBranch.startsWith('remotes/')) {
		tryRefs.push(baseBranch)
	} else {
		tryRefs.push(`origin/${baseBranch}`, baseBranch)
	}

	for (const ref of tryRefs) {
		try {
			await gitExec(['rev-parse', '--verify', `${ref}^{commit}`])
			return ref
		} catch {
			// try next candidate
		}
	}

	throw new Error(
		`Unknown base ref "${baseBranch}". Try: git fetch origin, or pass -b/--base with a valid branch or remote ref (e.g. origin/main).`
	)
}

/**
 * Get merge base between base branch and HEAD.
 * Results are cached per baseBranch for the lifetime of the process.
 */
const mergeBaseCache = new Map<string, string>()

export async function getMergeBase(baseBranch: string): Promise<string> {
	const cached = mergeBaseCache.get(baseBranch)
	if (cached) return cached

	const result = (await gitExec(['merge-base', baseBranch, 'HEAD'])).trim()
	mergeBaseCache.set(baseBranch, result)
	return result
}

/**
 * Get the git diff between merge-base and HEAD
 */
export async function getGitDiff(baseBranch: string): Promise<string> {
	const spinner = ora({
		text: `Getting diff against ${colors.highlight(baseBranch)}...`,
		spinner: 'dots'
	}).start()

	try {
		const mergeBase = await getMergeBase(baseBranch)
		const diff = await gitExec(['diff', `${mergeBase}..HEAD`])
		spinner.succeed(`Diff against ${colors.highlight(baseBranch)} successfully retrieved`)
		return diff
	} catch (error) {
		spinner.fail()
		const message = error instanceof Error ? error.message : String(error)
		throw new Error(`Error getting git diff: ${message}`)
	}
}

/**
 * Get list of changed files between merge-base and HEAD
 */
export async function getChangedFiles(baseBranch: string): Promise<string[]> {
	const mergeBase = await getMergeBase(baseBranch)
	const stdout = await gitExec(['diff', '--name-only', `${mergeBase}..HEAD`])
	return stdout.trim().split('\n').filter(line => line.trim() !== '')
}

/**
 * Get current branch name
 */
export async function getCurrentBranch(): Promise<string> {
	const stdout = await gitExec(['branch', '--show-current'])
	return stdout.trim()
}

/**
 * Push the current branch to origin with upstream tracking
 */
export async function pushBranchToRemote(branch: string): Promise<void> {
	const spinner = ora({
		text: `Pushing ${colors.highlight(branch)} to origin...`,
		spinner: 'dots'
	}).start()

	try {
		await new Promise<void>((resolve, reject) => {
			execFile('git', ['push', '--set-upstream', 'origin', branch], (err, _stdout, stderr) => {
				if (err) {
					reject(new Error(stderr?.trim() || err.message))
					return
				}
				resolve()
			})
		})
		spinner.succeed(`Branch ${colors.highlight(branch)} pushed to origin`)
	} catch (error) {
		spinner.fail('Failed to push branch')
		throw error
	}
}

/**
 * Get commit subjects from merge-base to HEAD (no merges)
 */
export async function getCommitSubjects(mergeBase: string): Promise<string[]> {
	const stdout = await gitExec(['log', `${mergeBase}..HEAD`, '--pretty=format:%s', '--no-merges'])
	return stdout.trim().split('\n').filter(line => line.trim() !== '')
}

/**
 * Read file content safely, with path traversal protection.
 * Only allows files within the repository root.
 */
export function readFileContent(filepath: string): string {
	const repoRoot = process.cwd()
	const fullPath = path.isAbsolute(filepath)
		? filepath
		: path.join(repoRoot, filepath)

	// Resolve to real path and verify it's within the repo
	const resolved = path.resolve(fullPath)
	if (!resolved.startsWith(repoRoot + path.sep) && resolved !== repoRoot) {
		throw new Error(`Access denied: ${filepath} is outside the repository`)
	}

	if (!statSync(resolved, { throwIfNoEntry: false })) {
		throw new Error(`File not found: ${filepath}`)
	}

	return readFileSync(resolved, 'utf8')
}

/**
 * Get directory structure, focused on directories containing changed files
 */
export function getDirectoryStructure(dir: string, changedFiles: string[] = []): string {
	const spinner = ora({
		text: 'Analyzing repository structure...',
		spinner: 'dots'
	}).start()

	try {
		const changedDirs = new Set<string>()

		changedFiles.forEach(file => {
			let parentDir = path.dirname(file)
			while (parentDir !== '.') {
				changedDirs.add(parentDir)
				parentDir = path.dirname(parentDir)
			}
			changedDirs.add('.')
		})

		const formatTree = (currentPath: string, prefix = '', depth = 0, maxDepth = 3): string => {
			if (depth > maxDepth) {
				return `${prefix}... (more items not shown)\n`
			}

			let items: string[]
			try {
				items = readdirSync(currentPath)
			} catch {
				return ''
			}

			// Cache stat results to avoid redundant calls
			const itemStats = new Map<string, { isDir: boolean }>()
			items = items.filter(item => {
				if (item.startsWith('.git')) return false
				const itemPath = path.join(currentPath, item)
				const stat = statSync(itemPath, { throwIfNoEntry: false })
				if (!stat) return false
				const isDir = stat.isDirectory()
				itemStats.set(item, { isDir })

				const relativePath = path.relative(dir, itemPath)
				if (isDir) {
					return changedDirs.has(relativePath) || depth === 0
				}
				return changedFiles.includes(relativePath) || depth === 0
			})

			items.sort((a, b) => {
				const aIsDir = itemStats.get(a)!.isDir
				const bIsDir = itemStats.get(b)!.isDir
				if (aIsDir && !bIsDir) return -1
				if (!aIsDir && bIsDir) return 1
				return a.localeCompare(b)
			})

			let result = ''

			items.forEach((item, index) => {
				const isLast = index === items.length - 1
				const itemPath = path.join(currentPath, item)
				const isDir = itemStats.get(item)!.isDir
				const connector = isLast ? '└── ' : '├── '
				const displayName = isDir ? `${item}/` : item
				const relativePath = path.relative(dir, itemPath)
				const isChanged = !isDir && changedFiles.includes(relativePath)
				const formattedName = isChanged ? colors.highlight(displayName) : displayName

				result += `${prefix}${connector}${formattedName}\n`

				if (isDir) {
					const newPrefix = prefix + (isLast ? '    ' : '│   ')
					result += formatTree(itemPath, newPrefix, depth + 1, maxDepth)
				}
			})

			return result
		}

		const rootDir = path.basename(dir)
		let treeOutput = `${rootDir}/\n`
		treeOutput += formatTree(dir)

		spinner.succeed('Repository structure analyzed')
		return treeOutput
	} catch (error) {
		spinner.fail('Failed to analyze repository structure')
		throw error
	}
}

/**
 * Build a short area-based summary from changed files
 */
export function summarizeChangedAreas(changedFiles: string[]): string | undefined {
	if (!changedFiles || changedFiles.length === 0) return undefined

	const areaCounts: Record<string, number> = {}

	changedFiles.forEach(file => {
		const area = file.includes('/') ? file.split('/')[0] : 'root files'
		areaCounts[area] = (areaCounts[area] || 0) + 1
	})

	const sortedAreas = Object.entries(areaCounts)
		.sort((a, b) => b[1] - a[1])
		.map(([area]) => area)

	if (sortedAreas.length === 1) {
		return `Update ${titleCase(sortedAreas[0])}`
	}

	const primary = titleCase(sortedAreas[0])
	const secondary = titleCase(sortedAreas[1])
	return `${primary} & ${secondary} updates`
}

/**
 * Build a concise summary from commit subjects
 */
export function summarizeCommitSubjects(commits: string[]): string | undefined {
	if (!commits || commits.length === 0) return undefined

	const cleaned = commits.map(c => {
		const match = c.match(/^[a-z]+(?:\([^)]+\))?:\s*(.*)$/i)
		return match ? match[1].trim() : c.trim()
	})

	if (cleaned.length === 1) {
		return cleaned[0]
	}

	const unique = Array.from(new Set(cleaned)).slice(0, 2)
	return unique.join(' • ')
}

function titleCase(text: string): string {
	return text
		.split(/[-_\s]+/)
		.map(word => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ')
}

export function buildBaseTitle(areaSummary?: string, commitSummary?: string): string {
	if (areaSummary && commitSummary) return `${areaSummary}: ${commitSummary}`
	if (areaSummary) return areaSummary
	if (commitSummary) return commitSummary
	return 'Update changes'
}

/**
 * Estimate if a diff is too large for an LLM context and truncate if needed.
 * Rough heuristic: ~4 chars per token, most models handle ~100k tokens.
 */
export function truncateDiff(diff: string, maxChars = 400_000): { diff: string; truncated: boolean; omittedSummary?: string } {
	if (diff.length <= maxChars) {
		return { diff, truncated: false }
	}

	// Split by file boundaries and keep as many complete files as possible
	const fileSections = diff.split(/^diff --git /m)
	const kept: string[] = []
	const omitted: string[] = []
	let currentLength = 0

	for (const section of fileSections) {
		if (!section.trim()) continue
		const full = `diff --git ${section}`
		if (currentLength + full.length <= maxChars * 0.9) {
			kept.push(full)
			currentLength += full.length
		} else {
			// Extract filename from the diff header
			const fileMatch = section.match(/^a\/(.+?) b\//)
			omitted.push(fileMatch ? fileMatch[1] : '(unknown file)')
		}
	}

	const omittedSummary = `\n\n[TRUNCATED: ${omitted.length} file(s) omitted due to size: ${omitted.slice(0, 10).join(', ')}${omitted.length > 10 ? '...' : ''}]`

	return {
		diff: kept.join('') + omittedSummary,
		truncated: true,
		omittedSummary
	}
}
