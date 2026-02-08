# AI Slop Meter (Slop Detective) 🕵️‍♂️

**AI Slop Meter** is a Chrome extension designed to detect potential AI-generated code ("slop") in GitHub repositories. It analyzes commit patterns, code comments, directory structures, and file uniformity to provide a "Slop Score."

## Features

- **Neural Pattern Detection**: Scans for common LLM-generated boilerplate and "helpful" comment patterns.
- **Commit Analysis**: Analyzes commit messages and frequencies for signs of automated or agentic behavior.
- **Structural Uniformity**: Detects highly repetitive or perfectly scaffolded directory structures typical of AI generators.
- **Noir Detective UI**: A unique, retro-themed interface for your investigation.
- **Cache Support**: Saves analysis results to stay within GitHub API limits.

## Installation

### From Source
1. Clone this repository.
2. Run `npm install` to install dependencies.
3. Run `npm run build` to generate the production build in the `dist` directory.
4. Open Chrome and navigate to `chrome://extensions/`.
5. Enable "Developer mode" (top right).
6. Click "Load unpacked" and select the `dist` folder.

## Usage
1. Navigate to any GitHub repository root (e.g., `https://github.com/owner/repo`).
2. Click the **Slop Detective** icon in your browser toolbar.
3. Click **Scan Target**.
4. (Optional) Add a GitHub Personal Access Token in the **Files** (settings) tab to avoid rate limits on private or large repos.

## Tech Stack
- **React 19** + **TypeScript**
- **Vite** + **CRXJS**
- **Tailwind CSS v4**
- **Radix UI** primitives
- **Lucide React** icons

## License
MIT
