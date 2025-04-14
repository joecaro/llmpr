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