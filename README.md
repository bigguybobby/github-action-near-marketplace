# NEAR Marketplace Auto-Submit GitHub Action

Automatically submit your tools, packages, and projects to [NEAR Marketplace](https://market.near.ai) when you create a release.

## Features

✅ **Auto-detection** - Reads metadata from `package.json`, `pyproject.toml`, or `Cargo.toml`  
✅ **Release triggers** - Submits on GitHub releases or tag pushes  
✅ **Smart updates** - Updates existing listings or creates new ones  
✅ **Customizable** - Override any field (name, description, tags, etc.)  
✅ **Secure** - Uses GitHub Secrets for API authentication  
✅ **Multi-language** - Supports Node.js, Python, Rust projects  

---

## Quick Start

### 1. Get Your NEAR Marketplace API Key

1. Visit [market.near.ai](https://market.near.ai)
2. Sign in and navigate to Settings → API Keys
3. Generate a new API key
4. Copy the key

### 2. Add API Key to GitHub Secrets

1. Go to your repository → Settings → Secrets and variables → Actions
2. Click **New repository secret**
3. Name: `NEAR_MARKET_API_KEY`
4. Value: (paste your API key)
5. Click **Add secret**

### 3. Create Workflow File

Create `.github/workflows/near-marketplace.yml`:

```yaml
name: Submit to NEAR Marketplace

on:
  release:
    types: [published]

jobs:
  submit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Submit to NEAR Marketplace
        uses: your-username/github-action-near-marketplace@v1
        with:
          api-key: ${{ secrets.NEAR_MARKET_API_KEY }}
```

### 4. Create a Release

When you publish a GitHub release, your project will automatically submit to NEAR Marketplace! 🎉

---

## Configuration

### Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `api-key` | ✅ Yes | - | NEAR Marketplace API key |
| `project-path` | No | `.` | Path to project root |
| `name` | No | (auto) | Override project name |
| `description` | No | (auto) | Override description |
| `tags` | No | (auto) | Comma-separated tags |
| `category` | No | `development` | Project category |
| `homepage` | No | (auto) | Homepage URL |
| `repository` | No | (auto) | Repository URL |
| `version` | No | (auto) | Version override |
| `update-existing` | No | `true` | Update existing listing |
| `dry-run` | No | `false` | Test mode (no submission) |

### Outputs

| Output | Description |
|--------|-------------|
| `listing-id` | NEAR Marketplace listing ID |
| `listing-url` | Public marketplace URL |
| `status` | `created`, `updated`, or `error` |

---

## Examples

### Basic Usage (Node.js Project)

```yaml
name: Submit to NEAR Marketplace

on:
  release:
    types: [published]

jobs:
  submit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Submit to Marketplace
        uses: your-username/github-action-near-marketplace@v1
        with:
          api-key: ${{ secrets.NEAR_MARKET_API_KEY }}
```

This will automatically read from `package.json`.

---

### Python Project with Custom Tags

```yaml
- name: Submit Python Package
  uses: your-username/github-action-near-marketplace@v1
  with:
    api-key: ${{ secrets.NEAR_MARKET_API_KEY }}
    tags: 'python,machine-learning,automation'
    category: 'ai-tools'
```

Reads from `pyproject.toml` and adds custom tags.

---

### Rust Project with Custom Description

```yaml
- name: Submit Rust Crate
  uses: your-username/github-action-near-marketplace@v1
  with:
    api-key: ${{ secrets.NEAR_MARKET_API_KEY }}
    description: 'High-performance CLI tool for NEAR blockchain'
    category: 'blockchain'
```

Reads from `Cargo.toml` with override description.

---

### Monorepo (Specific Package)

```yaml
- name: Submit Frontend Package
  uses: your-username/github-action-near-marketplace@v1
  with:
    api-key: ${{ secrets.NEAR_MARKET_API_KEY }}
    project-path: './packages/frontend'
    name: 'my-app-frontend'
```

---

### Dry Run (Test Before Submitting)

```yaml
- name: Test Marketplace Submission
  uses: your-username/github-action-near-marketplace@v1
  with:
    api-key: ${{ secrets.NEAR_MARKET_API_KEY }}
    dry-run: true
```

Validates configuration without submitting.

---

### Complete Example with Outputs

```yaml
name: Release to NEAR Marketplace

on:
  release:
    types: [published]

jobs:
  submit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Submit to Marketplace
        id: marketplace
        uses: your-username/github-action-near-marketplace@v1
        with:
          api-key: ${{ secrets.NEAR_MARKET_API_KEY }}
          tags: 'automation,github-actions,ci-cd'
          category: 'development'
          update-existing: true
      
      - name: Comment on Release
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.repos.createReleaseComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              release_id: context.payload.release.id,
              body: `🎉 Successfully submitted to NEAR Marketplace!\n\n` +
                    `📦 Listing: ${{ steps.marketplace.outputs.listing-url }}\n` +
                    `🆔 ID: ${{ steps.marketplace.outputs.listing-id }}\n` +
                    `✅ Status: ${{ steps.marketplace.outputs.status }}`
            });
```

---

### Tag-Based Releases

```yaml
name: Submit on Tag

on:
  push:
    tags:
      - 'v*'

jobs:
  submit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Submit to Marketplace
        uses: your-username/github-action-near-marketplace@v1
        with:
          api-key: ${{ secrets.NEAR_MARKET_API_KEY }}
          version: ${{ github.ref_name }}
```

---

## Supported Project Types

### Node.js / npm

Reads from `package.json`:
- `name` → listing name
- `version` → listing version
- `description` → listing description
- `keywords` → tags
- `repository` → repository URL
- `homepage` → homepage URL

### Python

Reads from `pyproject.toml`:
- `[project] name` → listing name
- `[project] version` → listing version
- `[project] description` → listing description
- `[project] repository` → repository URL

### Rust

Reads from `Cargo.toml`:
- `[package] name` → listing name
- `[package] version` → listing version
- `[package] description` → listing description
- `[package] keywords` → tags
- `[package] repository` → repository URL
- `[package] homepage` → homepage URL

---

## Troubleshooting

### "No package metadata found"

**Problem:** Action can't find `package.json`, `pyproject.toml`, or `Cargo.toml`.

**Solution:** 
```yaml
- uses: actions/checkout@v4  # Make sure to checkout first!
```

Or specify the path:
```yaml
with:
  project-path: './my-package'
```

---

### "Unauthorized" Error

**Problem:** Invalid or missing API key.

**Solution:**
1. Verify `NEAR_MARKET_API_KEY` is set in repository secrets
2. Check the API key is still valid at [market.near.ai](https://market.near.ai)
3. Ensure you're using `${{ secrets.NEAR_MARKET_API_KEY }}`

---

### Listing Not Updating

**Problem:** New releases don't update existing listing.

**Solution:**
```yaml
with:
  update-existing: true  # Default, but make sure it's set
```

---

### Custom Fields Not Working

**Problem:** Overrides aren't being applied.

**Solution:** Check YAML syntax and quotes:
```yaml
with:
  description: 'My custom description'  # Use quotes for strings
  tags: 'tag1,tag2,tag3'  # No spaces in comma-separated values
```

---

## API Reference

The action submits to `https://market.near.ai/v1/listings` with the following structure:

```json
{
  "name": "my-project",
  "version": "1.0.0",
  "description": "Project description",
  "category": "development",
  "homepage": "https://example.com",
  "repository": "https://github.com/user/repo",
  "tags": ["automation", "tools"],
  "metadata": {
    "author": "github-username",
    "license": "MIT",
    "release_tag": "refs/tags/v1.0.0",
    "submitted_at": "2024-01-01T00:00:00.000Z",
    "github_action": true
  }
}
```

---

## Development

### Local Testing

```bash
npm install
export INPUT_API_KEY="your-test-key"
export INPUT_PROJECT_PATH="."
export INPUT_DRY_RUN="true"
node src/index.js
```

### Build & Package

```bash
npm install
npm run build  # If using bundler
git add .
git commit -m "Release v1.0.0"
git tag v1.0.0
git push origin v1.0.0
```

---

## License

MIT License - feel free to use in your projects!

---

## Contributing

Issues and PRs welcome at [github.com/your-username/github-action-near-marketplace](https://github.com/your-username/github-action-near-marketplace)

---

## Support

- 📚 [NEAR Marketplace Docs](https://docs.near.ai/marketplace)
- 💬 [GitHub Discussions](https://github.com/your-username/github-action-near-marketplace/discussions)
- 🐛 [Report Issues](https://github.com/your-username/github-action-near-marketplace/issues)

---

**Made with ❤️ for the NEAR ecosystem**
