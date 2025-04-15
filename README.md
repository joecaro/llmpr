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
| `-m, --model <model>` | OpenAI model to use (default: "gpt-4o") |
| `-o, --output <file>` | Save PR description to file |
| `-v, --verbose` | Show detailed logs and API responses |
| `-s, --style <style>` | PR style: "concise" or "verbose" (default: "verbose") |
| `-l, --max-length <words>` | Maximum length in words (default: 500) |
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