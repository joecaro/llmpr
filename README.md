# llmpr

A CLI tool for generating Pull Request descriptions using OpenAI.

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

## Usage

Navigate to your Git repository and run:

```bash
llmpr
```

This will generate a PR description based on the diff between your current branch and main.

### Options

- `-b, --base <branch>`: Specify the base branch to compare against (default: "main")
- `-m, --model <model>`: Specify the OpenAI model to use (default: "gpt-4")
- `-o, --output <file>`: Save the PR description to a file instead of printing to console
- `-v, --verbose`: Show detailed logs including API requests and responses
- `-s, --silent`: Minimize output, show only the final result
- `-h, --help`: Display help information
- `-V, --version`: Display version information

### Examples

Compare against a different base branch:
```bash
llmpr --base develop
```

Use a different OpenAI model:
```bash
llmpr --model gpt-3.5-turbo
```

Save the PR description to a file:
```bash
llmpr --output pr-description.md
```

Show detailed API request/response information:
```bash
llmpr --verbose
```

Run in silent mode (minimal output):
```bash
llmpr --silent
```

## Features

- **Beautiful Terminal Output**: Color-coded logs and status messages 
- **Progress Indicators**: Loading spinners show you what's happening
- **API Response Logging**: Show detailed information about API calls with the `--verbose` flag
- **Formatted Output**: Clean, organized PR descriptions

## GitHub Action Integration

llmpr can be used as a GitHub Action to automatically generate PR descriptions when new pull requests are created.

### Setup

1. Add your OpenAI API key to GitHub Secrets as `OPENAI_API_KEY`
2. Use our pre-configured workflow file or create your own

### Usage Example

Add this workflow to your repository at `.github/workflows/pr-description.yml`:

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
          llmpr --base ${{ github.event.pull_request.base.ref }} --output pr_description.md
      
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

For more detailed setup instructions, see [GITHUB_ACTION_SETUP.md](./GITHUB_ACTION_SETUP.md).

### Reusable Workflow

We also provide a reusable workflow that can be called from your own workflows:

```yaml
name: My PR Description Workflow

on:
  pull_request:
    types: [opened]

jobs:
  call-llmpr-action:
    uses: yourusername/llmpr/.github/workflows/llmpr-action.yml@main
    with:
      base-branch: main
      model: gpt-4
      verbose: false
    secrets:
      OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

This allows for easy integration with your existing CI/CD pipelines.

### Comment-Based Trigger

You can also add a comment trigger to generate PR descriptions on demand:

1. Add the provided `comment-trigger.yml` workflow to your repository
2. On any PR, add a comment with `/generate-pr-description`
3. The workflow will automatically generate and update the PR description

This is useful for regenerating descriptions or generating them for PRs that were created before the automatic trigger was set up.