# Setting up llmpr as a GitHub Action

This guide explains how to set up the llmpr tool to automatically generate PR descriptions when new pull requests are created.

## Prerequisites

1. You need an OpenAI API key.
2. Your repository must have GitHub Actions enabled.

## Setup Instructions

### 1. Add OpenAI API Key to GitHub Secrets

1. Go to your GitHub repository
2. Click on "Settings" → "Secrets and variables" → "Actions"
3. Click "New repository secret"
4. Name: `OPENAI_API_KEY`
5. Value: Your OpenAI API key
6. Click "Add secret"

### 2. Create GitHub Actions Workflow File

The workflow file has already been created at `.github/workflows/pr-description.yml`. It contains all the necessary configuration to:

- Trigger when a new PR is opened
- Check out the code
- Set up Node.js
- Install dependencies and the llmpr tool
- Generate a PR description using the OpenAI API
- Update the PR description with the generated content

### 3. Test the Integration

1. Create a new branch
2. Make some changes
3. Push the branch to GitHub
4. Create a new PR
5. The GitHub Action will automatically run and update the PR description

### Customization

If you want to customize the llmpr behavior in the GitHub Action, you can modify the `.github/workflows/pr-description.yml` file:

- Change the OpenAI model by adding the `-m` flag with your preferred model
- Add the `-v` flag for verbose output
- Modify the base branch comparison with the `-b` flag (though the action already uses the PR's base branch)

### Troubleshooting

If the action fails:

1. Check the GitHub Actions logs for error messages
2. Verify your OpenAI API key is correct and has sufficient credits
3. Ensure the repository has the necessary permissions for the GitHub token
4. Check if the git diff command is working correctly in the action environment 