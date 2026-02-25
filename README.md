# LLMPR

> AI-powered Pull Request descriptions with one command

LLMPR generates professional PR descriptions—and structured code reviews—from your Git changes using your choice of LLM: OpenAI, Anthropic (Claude), or any OpenAI-compatible API (e.g. Ollama, Together).

## Features

- 🔄 **Git Integration**: Analyzes your current branch changes (large diffs are truncated automatically)
- 🤖 **Multiple Providers**: Use OpenAI, Anthropic, or any OpenAI-compatible endpoint
- ⚙️ **Config Files**: Set defaults in `.llmprrc.json` or `~/.config/llmpr/config.json`
- 🎨 **Three Styles**: Choose concise, standard, or verbose descriptions
- 📊 **Smart Visualizations**: Generates diagrams and code comparisons when needed
- 🔍 **Context-Aware**: Can request specific file contents for better understanding
- 📁 **Directory Visualization**: Shows repository structure with focus on changed files
- 📏 **Customizable Length**: Control the maximum size of your PR descriptions
- 📝 **Custom Templates**: Use `--template` with placeholders for your own prompt
- 🚀 **Interactive PR Creation**: Create GitHub PRs directly from the CLI with interactive prompts
- 🧠 **AI Review Mode**: Request a structured Good/Bad/Suggestions/Critical review of your diff
- 🔎 **Dry Run**: Preview the prompt without calling the LLM (`--dry-run`)

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

You need an API key for at least one supported provider. By default LLMPR uses OpenAI.

| Provider | Env variable(s) | Notes |
|----------|------------------|--------|
| **OpenAI** (default) | `OPENAI_API_KEY` | [Get a key](https://platform.openai.com/) |
| **Anthropic** (Claude) | `ANTHROPIC_API_KEY` | [Get a key](https://console.anthropic.com/) |
| **OpenAI-compatible** | `LLM_API_KEY`, optionally `LLM_BASE_URL` | For Ollama, Together, local endpoints, etc. |

Example (OpenAI):

```bash
export OPENAI_API_KEY=your_api_key
```

Or add it to your shell profile for persistence (e.g. `~/.zshrc`):

```bash
echo 'export OPENAI_API_KEY=your_api_key' >> ~/.zshrc
source ~/.zshrc
```

## Quick Start

1. Set an API key for your chosen provider (e.g. OpenAI):
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
| `-m, --model <model>` | LLM model to use (default: "gpt-5.1") |
| `-o, --output <file>` | Save PR description to file |
| `-r, --review` | Generate a structured code review instead of a PR description |
| `-v, --verbose` | Show detailed logs and API responses |
| `-s, --style <style>` | PR style: "concise", "standard", or "verbose" (default: "standard") |
| `-l, --max-length <words>` | Maximum length in words (default: 500) |
| `-c, --create-pr` | Create a GitHub PR after generating description (interactive) |
| `-p, --provider <provider>` | LLM provider: "openai", "anthropic", or "openai-compatible" (default: "openai") |
| `-t, --template <file>` | Custom prompt template file (see [Custom templates](#custom-templates)) |
| `--dry-run` | Show the prompt that would be sent without calling the LLM |
| `-gh, --github-config` | Check GitHub CLI auth and repo access, then exit |
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

# Generate a structured code review
llmpr -r

# Save the review to a file
llmpr -r -o review.md

# Limit length to 300 words
llmpr --max-length 300

# Use specific model
llmpr --model gpt-4-turbo

# Use Anthropic (Claude)
llmpr --provider anthropic --model claude-sonnet-4-20250514

# Use OpenAI-compatible endpoint (e.g. Ollama)
export LLM_BASE_URL=http://localhost:11434/v1
llmpr --provider openai-compatible --model llama3.2

# Preview prompt without calling the LLM
llmpr --dry-run

# Custom prompt template
llmpr --template ./my-pr-prompt.md

# Check GitHub CLI and repo access
llmpr --github-config

# Generate description and create PR interactively
llmpr --create-pr

# Create PR with custom base branch
llmpr --base develop --create-pr

# Combine options for complete workflow
llmpr --base develop --style verbose --create-pr
```

## Configuration

Defaults can be set via config files. CLI options override config.

- **Project**: `.llmprrc.json` in the repo root  
- **User**: `~/.config/llmpr/config.json`

Example `.llmprrc.json`:

```json
{
  "base": "main",
  "model": "gpt-4o",
  "style": "standard",
  "maxLength": "500",
  "provider": "openai"
}
```

Supported keys: `base`, `model`, `style`, `maxLength`, `provider`, `verbose`.

## Custom templates

Use `-t, --template <file>` to supply your own prompt. The file can use these placeholders:

| Placeholder | Replaced with |
|-------------|----------------|
| `{{diff}}` | Git diff against base branch |
| `{{dirStructure}}` | Repository tree (focused on changed files) |
| `{{style}}` | Current style (concise / standard / verbose) |
| `{{maxLength}}` | Max length in words |
| `{{base}}` | Base branch name |

The LLM will receive the result as the system/user prompt. Use this for team-specific formats or extra instructions.

## Interactive PR Creation

The `--create-pr` flag enables an interactive workflow that:

1. ✅ Generates an AI-powered PR description
2. ✅ Suggests a title based on your commits
3. ✅ Shows a preview of the generated description
4. ✅ Allows you to edit the title and description
5. ✅ Lets you confirm the base branch
6. ✅ Creates the PR as draft or ready for review
7. ✅ Prompts to push your branch to origin if needed, then retries PR creation automatically
8. ✅ Displays the PR URL and details

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

# If the branch is not yet pushed
✖ Failed to create pull request
Current branch must be pushed before creating a PR.
? Push feature/new-feature to origin now? › Yes
✔ Branch feature/new-feature pushed to origin
✔ Pull request created successfully!
```

## GitHub Action

LLMPR can automatically generate PR descriptions when PRs are created or on demand.

### Setup

1. Add your LLM API key to GitHub Secrets (e.g. `OPENAI_API_KEY` for the default provider, or `ANTHROPIC_API_KEY` if using `--provider anthropic`).
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
