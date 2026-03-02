/**
 * Prompt templates for PR descriptions and code reviews
 */

import type { CliOptions } from './types.js'

interface DiffStats {
	filesChanged: number
	insertions: number
	deletions: number
	newFiles: string[]
	modifiedFiles: string[]
	deletedFiles: string[]
}

function computeDiffStats(diff: string): DiffStats {
	const stats: DiffStats = {
		filesChanged: 0,
		insertions: 0,
		deletions: 0,
		newFiles: [],
		modifiedFiles: [],
		deletedFiles: [],
	}

	const fileHeaders = diff.match(/^diff --git a\/.+ b\/.+$/gm) || []
	stats.filesChanged = fileHeaders.length

	for (const line of diff.split('\n')) {
		if (line.startsWith('+') && !line.startsWith('+++')) {
			stats.insertions++
		} else if (line.startsWith('-') && !line.startsWith('---')) {
			stats.deletions++
		}
	}

	const diffSections = diff.split(/^diff --git /m).filter(Boolean)
	for (const section of diffSections) {
		const fileMatch = section.match(/a\/(.+?) b\//)
		if (!fileMatch) continue
		const filePath = fileMatch[1]

		if (section.includes('new file mode')) {
			stats.newFiles.push(filePath)
		} else if (section.includes('deleted file mode')) {
			stats.deletedFiles.push(filePath)
		} else {
			stats.modifiedFiles.push(filePath)
		}
	}

	return stats
}

function classifyImpact(stats: DiffStats): string {
	const { newFiles, modifiedFiles, deletedFiles, insertions, deletions } = stats
	const totalFiles = newFiles.length + modifiedFiles.length + deletedFiles.length
	if (totalFiles === 0) return 'No changes detected.'

	const newFileRatio = newFiles.length / totalFiles
	const modifiedRatio = modifiedFiles.length / totalFiles
	const deletedRatio = deletedFiles.length / totalFiles
	const churnRatio = insertions + deletions > 0 ? deletions / (insertions + deletions) : 0

	// Mostly new files, very little modification to existing code
	if (newFileRatio >= 0.8 && modifiedFiles.length <= 1) {
		return 'Mostly new code — minimal risk to existing functionality.'
	}
	// All new files
	if (newFileRatio === 1) {
		return 'Entirely new code — no existing code modified.'
	}
	// Heavy deletion / removal
	if (deletedRatio >= 0.5) {
		return 'Significant removal of existing code — verify nothing relied on deleted files.'
	}
	// Heavy churn in existing files
	if (modifiedRatio >= 0.7 && churnRatio >= 0.4) {
		return 'Heavy refactor of existing code — review carefully for regressions.'
	}
	// Moderate mix
	if (modifiedRatio >= 0.5) {
		return 'Moderate changes to existing code — some regression risk.'
	}
	// Mostly additive with some existing touches
	if (newFileRatio >= 0.5) {
		return 'Primarily new code with minor changes to existing files.'
	}
	// Small, focused edits
	if (totalFiles <= 3 && insertions + deletions < 50) {
		return 'Small, focused change — low risk.'
	}
	return 'Mixed new and modified code — review modified files for regressions.'
}

function formatDiffStats(stats: DiffStats): string {
	const totalLines = stats.insertions + stats.deletions
	const newPct = totalLines > 0 ? ((stats.insertions / totalLines) * 100).toFixed(1) : '0'
	const modPct = totalLines > 0 ? ((stats.deletions / totalLines) * 100).toFixed(1) : '0'

	let summary = `**PR Scope Summary:**
- ${stats.filesChanged} files changed (+${stats.insertions} / -${stats.deletions} lines)
- ~${newPct}% additions, ~${modPct}% deletions`

	if (stats.newFiles.length > 0) {
		summary += `\n- ${stats.newFiles.length} new files`
	}
	if (stats.deletedFiles.length > 0) {
		summary += `\n- ${stats.deletedFiles.length} deleted files`
	}
	if (stats.modifiedFiles.length > 0) {
		summary += `\n- ${stats.modifiedFiles.length} modified files`
	}

	summary += `\n- **Impact:** ${classifyImpact(stats)}`

	return summary
}

export function buildPrDescriptionPrompt(diff: string, dirStructure: string, options: CliOptions): string {
	const stats = computeDiffStats(diff)
	return `
${formatDiffStats(stats)}

You are an assistant that helps write PR descriptions.

**Diff interpretation (important):** The diff below shows ONLY the changes on the current branch since it diverged from ${options.base} (merge-base to HEAD). It does NOT include changes that were added to ${options.base} after the branch was created. In the diff: lines prefixed with \`-\` were REMOVED on this branch; lines prefixed with \`+\` were ADDED on this branch. Do not describe content that exists only on ${options.base} (e.g. additions that landed on ${options.base} after branching) as if it were removed or deleted on this branch. Describe only what this branch actually changed.

The diff is:
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

**Important:** Include the PR Scope Summary (shown above) at the very top of the PR description so reviewers can quickly gauge the size and nature of the changes.

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
- Include a brief explanation of what the diagram shows`
	: ''}

*MAKE SURE NOT TO ADD ITEMS OR SECTIONS IF THEY ARE NOT NEEDED. I.E. A SIMPLE CHANGE DOESN'T NEED A DIAGRAM OR EXTENSIVE EXAMPLES. ONLY INCLUDE DIAGRAMS OR CODE SNIPPETS IF THEY ARE NECESSARY TO EXPLAIN THE CHANGES.*

If you need to see the contents of any specific file to better understand the changes, you can request it by including [NEED_CONTEXT:filepath] in your response. For example, [NEED_CONTEXT:src/config.ts]. You can request up to 3 files for additional context.`
}

export function buildReviewPrompt(diff: string, dirStructure: string, options: CliOptions): string {
	const stats = computeDiffStats(diff)
	return `
${formatDiffStats(stats)}

You are a senior software engineer performing a rigorous peer review.

**Diff interpretation (important):** The diff below shows ONLY the changes on the current branch since it diverged from ${options.base} (merge-base to HEAD). It does NOT include changes that were added to ${options.base} after the branch was created. In the diff: lines prefixed with \`-\` were REMOVED on this branch; lines prefixed with \`+\` were ADDED on this branch. Do not treat content that exists only on ${options.base} (e.g. additions that landed on ${options.base} after branching) as if it were removed or deleted on this branch. Review only what this branch actually changed.

The diff is:
${diff}

The repository structure is:
\`\`\`
${dirStructure}
\`\`\`

Provide a structured markdown review with the following sections in order:

## Good
- Celebrate what is working well, notable improvements, or strong patterns.

## Bad
- Call out risky or incorrect changes that are concerning but not necessarily blocking.

## Suggestions
- Recommend follow-up improvements, additional tests, documentation, or refactors. Be actionable.

## Critical Fixes
- Highlight blockers that must be addressed before shipping. Explain impact and preferred fixes.

Guidelines:
- Each section should contain concise bullet points; use "- None" if there is nothing to report.
- Reference files or snippets when possible (e.g., \`src/app.ts:42\`).
- Focus on correctness, security, tests, and developer experience.
- Keep the overall review under ${options.maxLength} words and prioritize the highest-impact findings.

If you need to see the contents of any specific file to better understand the changes, request it by including [NEED_CONTEXT:filepath] in your response (maximum 3 files).`
}
