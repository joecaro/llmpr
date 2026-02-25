/**
 * Prompt templates for PR descriptions and code reviews
 */

import type { CliOptions } from './types.js'

export function buildPrDescriptionPrompt(diff: string, dirStructure: string, options: CliOptions): string {
	return `
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
	return `
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
