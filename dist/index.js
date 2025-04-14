#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const child_process_1 = require("child_process");
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const axios_1 = __importDefault(require("axios"));
const commander_1 = require("commander");
const chalk_1 = __importDefault(require("chalk"));
const ora_1 = __importDefault(require("ora"));
const boxen_1 = __importDefault(require("boxen"));
const figures_1 = __importDefault(require("figures"));
// Terminal colors and styles
const colors = {
    primary: chalk_1.default.hex('#7C3AED'), // Vibrant purple
    secondary: chalk_1.default.hex('#60A5FA'), // Bright blue
    success: chalk_1.default.hex('#10B981'), // Emerald green
    warning: chalk_1.default.hex('#F59E0B'), // Amber
    error: chalk_1.default.hex('#EF4444'), // Red
    info: chalk_1.default.hex('#6B7280'), // Gray
    heading: chalk_1.default.bold.hex('#7C3AED').underline,
    subheading: chalk_1.default.bold.hex('#60A5FA'),
    dim: chalk_1.default.dim,
    highlight: chalk_1.default.hex('#F472B6') // Pink
};
// Fancy logger
const logger = {
    clear: () => {
        process.stdout.write('\x1Bc');
    },
    title: (text) => {
        console.log('\n' + colors.heading(text) + '\n');
    },
    info: (text) => {
        console.log(colors.info(`${figures_1.default.info} ${text}`));
    },
    success: (text) => {
        console.log(colors.success(`${figures_1.default.tick} ${text}`));
    },
    warning: (text) => {
        console.log(colors.warning(`${figures_1.default.warning} ${text}`));
    },
    error: (text) => {
        console.log(colors.error(`${figures_1.default.cross} ${text}`));
    },
    step: (text) => {
        console.log(colors.secondary(`${figures_1.default.pointer} ${text}`));
    },
    box: (text, title) => {
        console.log((0, boxen_1.default)(text, {
            padding: 1,
            margin: 1,
            borderStyle: 'round',
            borderColor: 'magenta',
            title: title || undefined,
            titleAlignment: 'center'
        }));
    },
    code: (text) => {
        console.log('\n' + chalk_1.default.bgHex('#282A36').white(text) + '\n');
    },
    divider: () => {
        console.log(colors.dim('─'.repeat(process.stdout.columns || 80)));
    }
};
// Setup command line options
commander_1.program
    .version('1.0.0')
    .option('-b, --base <branch>', 'base branch to compare against', 'main')
    .option('-m, --model <model>', 'OpenAI model to use', 'gpt-4o-mini')
    .option('-o, --output <file>', 'output file for PR description')
    .option('-v, --verbose', 'show detailed logs and API responses')
    .option('-s, --silent', 'minimize output, show only the final result')
    .parse(process.argv);
const options = commander_1.program.opts();
// Get API key from environment variable or prompt the user
function getApiKey() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        logger.error('OPENAI_API_KEY environment variable is not set');
        logger.info('Please set it using: export OPENAI_API_KEY=your_api_key');
        process.exit(1);
    }
    return apiKey;
}
function getGitDiff() {
    const spinner = (0, ora_1.default)({
        text: `Getting diff against ${colors.highlight(options.base)}...`,
        spinner: 'dots'
    }).start();
    return new Promise((resolve, reject) => {
        (0, child_process_1.exec)(`git diff ${options.base}`, (err, stdout, stderr) => {
            if (err) {
                spinner.fail();
                // Wrap in an Error object so error.message is set
                reject(new Error(`Error getting git diff: ${stderr || err.message}`));
                return;
            }
            spinner.succeed(`Diff against ${colors.highlight(options.base)} successfully retrieved`);
            resolve(stdout);
        });
    });
}
function getDirectoryStructure(dir) {
    const spinner = (0, ora_1.default)({
        text: 'Analyzing repository structure...',
        spinner: 'dots'
    }).start();
    try {
        const structure = (0, fs_1.readdirSync)(dir).map(file => {
            const fullPath = path_1.default.join(dir, file);
            return { name: file, isDir: (0, fs_1.statSync)(fullPath).isDirectory() };
        });
        spinner.succeed('Repository structure analyzed');
        return structure;
    }
    catch (error) {
        spinner.fail('Failed to analyze repository structure');
        throw error;
    }
}
async function sendPromptToOpenAI(prompt) {
    const apiKey = getApiKey();
    const spinner = (0, ora_1.default)({
        text: `Generating PR description using ${colors.highlight(options.model)}...`,
        spinner: 'dots'
    }).start();
    try {
        // Log the request if verbose
        if (options.verbose) {
            spinner.stop();
            logger.title('API Request');
            logger.box(prompt, 'Prompt');
            spinner.start();
        }
        const startTime = Date.now();
        const response = await axios_1.default.post('https://api.openai.com/v1/chat/completions', {
            model: options.model,
            messages: [{ role: 'system', content: prompt }]
        }, {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        const endTime = Date.now();
        const duration = ((endTime - startTime) / 1000).toFixed(2);
        spinner.succeed(`PR description generated in ${colors.highlight(duration + 's')}`);
        // Log the response if verbose
        if (options.verbose) {
            logger.title('API Response');
            logger.info(`Model: ${colors.highlight(options.model)}`);
            logger.info(`Prompt tokens: ${colors.highlight(response.data.usage?.prompt_tokens?.toString() || 'unknown')}`);
            logger.info(`Completion tokens: ${colors.highlight(response.data.usage?.completion_tokens?.toString() || 'unknown')}`);
            logger.info(`Total tokens: ${colors.highlight(response.data.usage?.total_tokens?.toString() || 'unknown')}`);
            logger.info(`Duration: ${colors.highlight(duration + 's')}`);
        }
        return response.data.choices[0].message.content.trim();
    }
    catch (error) {
        spinner.fail('Failed to generate PR description');
        throw new Error(`OpenAI API Error: ${error.response?.data?.error?.message || error.message}`);
    }
}
async function main() {
    try {
        // Clear console and show banner
        if (!options.silent) {
            logger.clear();
            logger.box(colors.primary.bold('LLMPR') + '\n' + colors.info('AI-powered PR descriptions'), 'v1.0.0');
        }
        // Get diff and directory structure
        const diff = await getGitDiff();
        if (diff.trim() === '') {
            logger.warning('No changes detected. Make sure you have uncommitted changes.');
            process.exit(0);
        }
        const dirStructure = getDirectoryStructure(process.cwd());
        // Build the prompt
        const initialPrompt = `
You are an assistant that helps write PR descriptions.
The diff from my branch compared to ${options.base} is:
${diff}

The repository structure is:
${JSON.stringify(dirStructure, null, 2)}

Write a complete, concise, and professional PR description including:
1. Summary of changes
2. Purpose of the PR
3. Key implementation details
4. Any important notes or warnings

The PR description should be in markdown format.

The PR description should be no more than 100 words.

You can use markdown formatting including:
- Lists
- Code blocks
- Links
- Bold and italic text
- Headings
- Quotes
- Mermaid diagrams if applicable and if it would be very helpful
`;
        // Send to OpenAI and get response
        const response = await sendPromptToOpenAI(initialPrompt);
        // Display or save the result
        if (options.output) {
            (0, fs_1.writeFileSync)(options.output, response);
            logger.success(`PR description saved to ${colors.highlight(options.output)}`);
            if (!options.silent) {
                logger.info(`Use ${colors.highlight(`cat ${options.output}`)} to view the content`);
            }
        }
        else {
            logger.divider();
            logger.title('Generated PR Description');
            console.log(response);
            logger.divider();
            if (!options.silent) {
                logger.info('Copy the text above for your PR description');
                logger.info(`Tip: Use ${colors.highlight('llmpr -o pr.md')} to save to a file next time`);
            }
        }
    }
    catch (error) {
        logger.error(error.message || 'An unknown error occurred');
        process.exit(1);
    }
}
main();
