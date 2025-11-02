# LLMPR

> AI-powered Pull Request descriptions with one command

LLMPR generates professional PR descriptions from your Git changes using OpenAI's language models.

## Features

- 🔄 **Git Integration**: Analyzes your current branch changes
- 🎨 **Two Styles**: Choose concise or verbose descriptions
- 📊 **Smart Visualizations**: Generates diagrams and code comparisons when needed
- 🔍 **Context-Aware**: Can request specific file contents for better understanding
- 📁 **Directory Visualization**: Shows repository structure with focus on changed files
- 📏 **Customizable Length**: Control the maximum size of your PR descriptions
- 🚀 **Interactive PR Creation**: Create GitHub PRs directly from the CLI with interactive prompts

## Installation

You can install the package globally using npm:

```bash
npm install -g llmpr
```

Or, to install from source:

```bash
git clone https://github.com/yourusername/llmpr.git
cd llmpr
npm install
npm run build
npm install -g .
```

## Prerequisites

You need to have an OpenAI API key. You can get one from [OpenAI's website](https://platform.openai.com/).

Set your API key as an environment variable:

```bash
export OPENAI_API_KEY=your_api_key
```

Or add it to your shell profile for persistence (e.g., ~/.bash_profile, ~/.zshrc):

```bash
echo 'export OPENAI_API_KEY=your_api_key' >> ~/.zshrc
source ~/.zshrc
```

## Quick Start

1. Set your OpenAI API key:
   ```bash
   export OPENAI_API_KEY=your_api_key
   ```

2. Run in your Git repository:
   ```bash
   llmpr
   ```

## Usage

```
llmpr [options]
```

### Options

| Option | Description |
|--------|-------------|
| `-b, --base <branch>` | Base branch to compare against (default: "main") |
| `-m, --model <model>` | OpenAI model to use (default: "gpt-5") |
| `-o, --output <file>` | Save PR description to file |
| `-v, --verbose` | Show detailed logs and API responses |
| `-s, --style <style>` | PR style: "concise", "standard", or "verbose" (default: "standard") |
| `-l, --max-length <words>` | Maximum length in words (default: 500) |
| `-c, --create-pr` | Create a GitHub PR after generating description (interactive) |
| `-h, --help` | Display help |
| `-V, --version` | Display version |

### Examples

```bash
# Generate against develop branch
llmpr --base develop

# Save to file
llmpr -o pr.md

# Concise description
llmpr --style concise

# Limit length to 300 words
llmpr --max-length 300

# Use specific OpenAI model
llmpr --model gpt-4-turbo

# Generate description and create PR interactively
llmpr --create-pr

# Create PR with custom base branch
llmpr --base develop --create-pr

# Combine options for complete workflow
llmpr --base develop --style verbose --create-pr
```

## Interactive PR Creation

The `--create-pr` flag enables an interactive workflow that:

1. ✅ Generates an AI-powered PR description
2. ✅ Suggests a title based on your commits
3. ✅ Shows a preview of the generated description
4. ✅ Allows you to edit the title and description
5. ✅ Lets you confirm the base branch
6. ✅ Creates the PR as draft or ready for review
7. ✅ Displays the PR URL and details

### Prerequisites for PR Creation

- **GitHub CLI (`gh`)** must be installed and authenticated
  - Install: `brew install gh` (macOS) or visit https://cli.github.com/
  - Authenticate: `gh auth login`
- **Repository access**: You must be a collaborator with write access
  - If you don't have access, you can fork the repo and create PRs from your fork
  - Or use `llmpr` without `--create-pr` to generate the description and create the PR manually

### Example Interactive Flow

```bash
$ llmpr --create-pr

Starting LLMPR...
✔ Diff against main successfully retrieved
✔ Repository structure analyzed
✔ PR description generated in 3.45s after 1 round
─────────────────────────────────────────────────────

PR Creation Flow

ℹ Current branch: feature/new-feature
─────────────────────────────────────────────────────
Generated Description Preview
Add interactive PR creation feature with gh CLI...
─────────────────────────────────────────────────────
? PR Title: › Add interactive PR creation with GitHub CLI
? Edit the generated description? › No
? Base branch: › main
? Create as draft PR? › No
? Create pull request? › Yes

✔ Pull request created successfully!
─────────────────────────────────────────────────────
✔ Pull Request Created!
─────────────────────────────────────────────────────

┌─────────────────────── PR Details ────────────────────────┐
│                                                            │
│  Title: Add interactive PR creation with GitHub CLI       │
│                                                            │
│  Base Branch: main                                         │
│  Status: Ready for Review                                  │
│                                                            │
│  URL: https://github.com/user/repo/pull/123               │
│                                                            │
└────────────────────────────────────────────────────────────┘

ℹ Open in browser: https://github.com/user/repo/pull/123
```

## GitHub Action

LLMPR can automatically generate PR descriptions when PRs are created or on demand.

### Setup

1. Add your OpenAI API key to GitHub Secrets as `OPENAI_API_KEY`
2. Create a workflow file at `.github/workflows/pr-description.yml`:

```yaml
name: Generate PR Description

on:
  pull_request:
    types: [opened]

jobs:
  generate-pr-description:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          fetch-depth: 0
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      - name: Install llmpr
        run: npm install -g llmpr
      
      - name: Generate PR description
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
        run: |
          llmpr --base ${{ github.event.pull_request.base.ref }} --output pr_description.md --style verbose
      
      - name: Update PR description
        uses: actions/github-script@v7
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          script: |
            const fs = require('fs');
            const prDescription = fs.readFileSync('pr_description.md', 'utf8');
            
            await github.rest.pulls.update({
              owner: context.repo.owner,
              repo: context.repo.repo,
              pull_number: context.issue.number,
              body: prDescription
            });
```

### Comment Trigger

Add a comment-based trigger to generate PR descriptions on demand:

1. Create `.github/workflows/comment-trigger.yml`
2. In any PR, comment `/generate-pr-description`

## Why LLMPR?

- **Save Time**: Generate comprehensive PR descriptions in seconds
- **Consistency**: Create standardized, high-quality documentation
- **Clarity**: Help reviewers understand changes more quickly
- **Collaboration**: Improve team communication with clear change explanations

## License

MIT