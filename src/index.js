'use strict';

const core = require('@actions/core');
const github = require('@actions/github');
const fs = require('fs');
const path = require('path');
const https = require('https');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MARKETPLACE_API = 'https://market.near.ai/v1';

/** Required fields that must be non-empty in the final payload. */
const REQUIRED_FIELDS = ['name', 'version', 'description', 'category', 'repository'];

/** Optional fields that produce warnings when absent. */
const OPTIONAL_FIELDS = ['homepage', 'long_description', 'changelog', 'license'];

// ---------------------------------------------------------------------------
// Metadata parsers
// ---------------------------------------------------------------------------

/**
 * Read project metadata from package.json (Node.js / npm).
 * @param {string} projectPath - Absolute path to the project root.
 * @returns {{ name: string, version: string, description: string, keywords: string[], [key: string]: any }|null}
 */
function readFromPackageJson(projectPath) {
  const filePath = path.join(projectPath, 'package.json');
  if (!fs.existsSync(filePath)) return null;

  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to parse package.json: ${err.message}`);
  }

  core.info('✓ Found package.json');
  return {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    homepage: pkg.homepage,
    repository: typeof pkg.repository === 'object' ? pkg.repository.url : pkg.repository,
    keywords: Array.isArray(pkg.keywords) ? pkg.keywords : [],
    author: typeof pkg.author === 'object' ? pkg.author.name : pkg.author,
    license: pkg.license,
  };
}

/**
 * Read project metadata from pyproject.toml (Python / PEP 518).
 * @param {string} projectPath
 * @returns {object|null}
 */
function readFromPyproject(projectPath) {
  const filePath = path.join(projectPath, 'pyproject.toml');
  if (!fs.existsSync(filePath)) return null;

  const toml = fs.readFileSync(filePath, 'utf8');
  const extract = (key) => { const m = toml.match(new RegExp(`${key}\\s*=\\s*"([^"]+)"`)); return m ? m[1] : undefined; };
  const extractList = (key) => {
    const m = toml.match(new RegExp(`${key}\\s*=\\s*\\[([^\\]]+)\\]`));
    if (!m) return [];
    return m[1].split(',').map(k => k.trim().replace(/^"|"$/g, '')).filter(Boolean);
  };

  core.info('✓ Found pyproject.toml');
  return {
    name: extract('name'),
    version: extract('version'),
    description: extract('description'),
    homepage: extract('homepage') || extract('"Homepage"'),
    repository: extract('repository') || extract('"Repository"'),
    keywords: extractList('keywords'),
    license: extract('license'),
  };
}

/**
 * Read project metadata from Cargo.toml (Rust).
 * @param {string} projectPath
 * @returns {object|null}
 */
function readFromCargo(projectPath) {
  const filePath = path.join(projectPath, 'Cargo.toml');
  if (!fs.existsSync(filePath)) return null;

  const toml = fs.readFileSync(filePath, 'utf8');
  const extract = (key) => { const m = toml.match(new RegExp(`${key}\\s*=\\s*"([^"]+)"`)); return m ? m[1] : undefined; };
  const kw = toml.match(/keywords\s*=\s*\[(.*?)\]/s);

  core.info('✓ Found Cargo.toml');
  return {
    name: extract('name'),
    version: extract('version'),
    description: extract('description'),
    homepage: extract('homepage'),
    repository: extract('repository'),
    keywords: kw ? kw[1].split(',').map(k => k.trim().replace(/"/g, '')).filter(Boolean) : [],
    license: extract('license'),
  };
}

/**
 * Read project metadata from supported manifest files.
 * @param {string} projectPath - Absolute path to project root.
 * @returns {object} Metadata object.
 * @throws {Error} If no supported manifest is found.
 */
function readProjectMetadata(projectPath) {
  const metadata =
    readFromPackageJson(projectPath) ||
    readFromPyproject(projectPath) ||
    readFromCargo(projectPath);

  if (!metadata) {
    throw new Error(
      `No supported manifest found in "${projectPath}". ` +
      'Expected one of: package.json, pyproject.toml, Cargo.toml. ' +
      'Check that "project-path" points to the correct directory.'
    );
  }

  return metadata;
}

// ---------------------------------------------------------------------------
// Payload validation
// ---------------------------------------------------------------------------

/**
 * Validate the submission payload and collect warnings.
 * @param {object} payload - Payload to validate.
 * @returns {{ errors: string[], warnings: string[] }}
 */
function validatePayload(payload) {
  const errors = [];
  const warnings = [];

  for (const field of REQUIRED_FIELDS) {
    if (!payload[field] || String(payload[field]).trim() === '') {
      errors.push(
        `Required field "${field}" is missing or empty. ` +
        `Provide it via the "${field}" action input or add it to your package manifest.`
      );
    }
  }

  for (const field of OPTIONAL_FIELDS) {
    if (!payload[field] || String(payload[field]).trim() === '') {
      warnings.push(`Optional field "${field}" is not set — consider adding it for a better listing.`);
    }
  }

  // Version format warning
  if (payload.version && !/^\d+\.\d+/.test(payload.version)) {
    warnings.push(
      `Version "${payload.version}" doesn't look like semver (x.y.z). ` +
      'The marketplace prefers semantic versioning.'
    );
  }

  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

/**
 * Make an HTTPS request and return parsed response.
 * @param {string} url
 * @param {{ method?: string, headers?: object }} options
 * @param {object|null} data - JSON body (for POST/PUT).
 * @returns {Promise<{ statusCode: number, body: any }>}
 */
function httpsRequest(url, options, data = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };

    const req = https.request(reqOptions, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(body); } catch { parsed = body; }

        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ statusCode: res.statusCode, body: parsed });
        } else {
          const detail = typeof parsed === 'object'
            ? (parsed.message || parsed.error || JSON.stringify(parsed))
            : body.slice(0, 200);
          reject(new Error(
            `Marketplace API returned HTTP ${res.statusCode}: ${detail}. ` +
            `URL: ${url}`
          ));
        }
      });
    });

    req.on('error', (err) => reject(new Error(`Network error calling marketplace API: ${err.message}`)));

    if (data) {
      const serialised = typeof data === 'string' ? data : JSON.stringify(data);
      req.setHeader('Content-Length', Buffer.byteLength(serialised));
      req.write(serialised);
    }

    req.end();
  });
}

// ---------------------------------------------------------------------------
// Marketplace API
// ---------------------------------------------------------------------------

/**
 * Find an existing listing by name.
 * @param {string} apiKey
 * @param {string} name
 * @param {string} marketplaceApi
 * @returns {Promise<string|null>} Listing ID or null.
 */
async function findExistingListing(apiKey, name, marketplaceApi) {
  try {
    const response = await httpsRequest(
      `${marketplaceApi}/listings?name=${encodeURIComponent(name)}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': 'github-action-near-marketplace/2.0',
        },
      }
    );

    if (response.body && response.body.data && response.body.data.length > 0) {
      return response.body.data[0].id;
    }
  } catch (err) {
    core.debug(`Listing lookup failed (may not exist yet): ${err.message}`);
  }
  return null;
}

/**
 * Create or update a marketplace listing.
 * @param {string} apiKey
 * @param {object} payload
 * @param {string|null} listingId
 * @param {string} marketplaceApi
 * @returns {Promise<object>} API response body.
 */
async function submitToMarketplace(apiKey, payload, listingId, marketplaceApi) {
  const method = listingId ? 'PUT' : 'POST';
  const url = listingId
    ? `${marketplaceApi}/listings/${listingId}`
    : `${marketplaceApi}/listings`;

  core.info(`→ ${method} ${url}`);
  core.debug(`Payload: ${JSON.stringify(payload, null, 2)}`);

  const response = await httpsRequest(
    url,
    {
      method,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'github-action-near-marketplace/2.0',
      },
    },
    payload
  );

  return response.body;
}

// ---------------------------------------------------------------------------
// Main action
// ---------------------------------------------------------------------------

/**
 * Main action entry point.
 */
async function run() {
  try {
    const marketplaceApi = core.getInput('marketplace-url') || DEFAULT_MARKETPLACE_API;
    const apiKey = core.getInput('api-key', { required: true });
    const projectPath = path.resolve(core.getInput('project-path') || '.');
    const dryRun = core.getInput('dry-run') === 'true';
    const validateOnly = core.getInput('validate-only') === 'true';
    const updateExisting = core.getInput('update-existing') !== 'false';
    const failOnWarning = core.getInput('fail-on-warning') === 'true';

    // --- Read metadata ---
    core.info('📦 Reading project metadata…');
    if (!fs.existsSync(projectPath)) {
      throw new Error(
        `Project path does not exist: "${projectPath}". ` +
        'Make sure "project-path" is correct and the repository was checked out.'
      );
    }
    const metadata = readProjectMetadata(projectPath);
    core.info(`   Name:    ${metadata.name}`);
    core.info(`   Version: ${metadata.version}`);

    // --- Build payload ---
    const repoUrl = `https://github.com/${github.context.repo.owner}/${github.context.repo.repo}`;
    const payload = {
      name:             core.getInput('name')        || metadata.name        || '',
      version:          core.getInput('version')     || metadata.version     || github.context.ref.replace('refs/tags/', ''),
      description:      core.getInput('description') || metadata.description || '',
      long_description: core.getInput('long-description') || '',
      category:         core.getInput('category')    || 'development',
      homepage:         core.getInput('homepage')    || metadata.homepage    || '',
      repository:       core.getInput('repository')  || metadata.repository  || repoUrl,
      license:          core.getInput('license')     || metadata.license     || 'MIT',
      changelog:        core.getInput('changelog')   || '',
      pricing:          core.getInput('pricing')     || 'free',
      min_near_version: core.getInput('min-near-version') || '',
      tags:             [],
      metadata: {
        author:       metadata.author || github.context.actor,
        release_tag:  github.context.ref,
        submitted_at: new Date().toISOString(),
        github_action: true,
        github_run_id: github.context.runId,
        github_sha:    github.context.sha,
      },
    };

    // Tags
    const customTags = core.getInput('tags');
    payload.tags = customTags
      ? customTags.split(',').map(t => t.trim()).filter(Boolean)
      : (metadata.keywords || []);

    // --- Validate ---
    core.info('');
    core.info('🔍 Validating payload…');
    const { errors, warnings } = validatePayload(payload);

    if (warnings.length > 0) {
      warnings.forEach(w => core.warning(w));
      core.setOutput('warnings', JSON.stringify(warnings));
    }

    if (errors.length > 0) {
      const msg = errors.map((e, i) => `  ${i + 1}. ${e}`).join('\n');
      throw new Error(`Payload validation failed:\n${msg}`);
    }

    if (failOnWarning && warnings.length > 0) {
      throw new Error(`fail-on-warning is enabled and ${warnings.length} warning(s) were raised.`);
    }

    if (validateOnly) {
      core.info('✅ Validation passed (validate-only mode — not submitting)');
      core.setOutput('status', 'validated');
      core.setOutput('listing-id', '');
      core.setOutput('listing-url', '');
      return;
    }

    // --- Log summary ---
    core.info('');
    core.info('📋 Submission summary:');
    core.info(`   Name:       ${payload.name}`);
    core.info(`   Version:    ${payload.version}`);
    core.info(`   Category:   ${payload.category}`);
    core.info(`   License:    ${payload.license}`);
    core.info(`   Pricing:    ${payload.pricing}`);
    core.info(`   Tags:       ${payload.tags.join(', ') || '(none)'}`);
    core.info(`   Repository: ${payload.repository}`);

    if (dryRun) {
      core.warning('🧪 DRY RUN — not submitting to marketplace');
      core.setOutput('status', 'dry-run');
      core.setOutput('listing-id', 'dry-run');
      core.setOutput('listing-url', '');
      return;
    }

    // --- Submit ---
    let listingId = null;
    if (updateExisting) {
      core.info('');
      core.info('🔍 Checking for existing listing…');
      listingId = await findExistingListing(apiKey, payload.name, marketplaceApi);
      core.info(listingId ? `   Found: ${listingId}` : '   No existing listing found');
    }

    core.info('');
    core.info(`🚀 ${listingId ? 'Updating' : 'Creating'} listing…`);
    const result = await submitToMarketplace(apiKey, payload, listingId, marketplaceApi);

    const finalId   = result.id || result.data?.id || listingId || 'unknown';
    const publicUrl = `${marketplaceApi.replace('/v1', '')}/listing/${finalId}`;
    const status    = listingId ? 'updated' : 'created';

    core.info('');
    core.info('✅ Success!');
    core.info(`   Status:     ${status}`);
    core.info(`   Listing ID: ${finalId}`);
    core.info(`   URL:        ${publicUrl}`);

    core.setOutput('listing-id',  finalId);
    core.setOutput('listing-url', publicUrl);
    core.setOutput('status',      status);

  } catch (err) {
    core.setFailed(`❌ Action failed: ${err.message}`);
    core.setOutput('status', 'error');
  }
}

run();

// Export internals for testing
module.exports = {
  readProjectMetadata,
  readFromPackageJson,
  readFromPyproject,
  readFromCargo,
  validatePayload,
  httpsRequest,
  findExistingListing,
  submitToMarketplace,
};
