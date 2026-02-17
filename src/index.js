const core = require('@actions/core');
const github = require('@actions/github');
const fs = require('fs');
const path = require('path');
const https = require('https');

const MARKETPLACE_API = 'https://market.near.ai/v1';

/**
 * Read project metadata from various package formats
 */
function readProjectMetadata(projectPath) {
  const metadata = {};
  
  // Try package.json (Node.js/npm)
  const packageJsonPath = path.join(projectPath, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    metadata.name = pkg.name;
    metadata.version = pkg.version;
    metadata.description = pkg.description;
    metadata.homepage = pkg.homepage;
    metadata.repository = pkg.repository?.url || pkg.repository;
    metadata.keywords = pkg.keywords || [];
    metadata.author = pkg.author;
    metadata.license = pkg.license;
    core.info('✓ Found package.json');
    return metadata;
  }
  
  // Try pyproject.toml (Python)
  const pyprojectPath = path.join(projectPath, 'pyproject.toml');
  if (fs.existsSync(pyprojectPath)) {
    const toml = fs.readFileSync(pyprojectPath, 'utf8');
    const nameMatch = toml.match(/name\s*=\s*"([^"]+)"/);
    const versionMatch = toml.match(/version\s*=\s*"([^"]+)"/);
    const descMatch = toml.match(/description\s*=\s*"([^"]+)"/);
    const homepageMatch = toml.match(/homepage\s*=\s*"([^"]+)"/);
    const repoMatch = toml.match(/repository\s*=\s*"([^"]+)"/);
    
    if (nameMatch) metadata.name = nameMatch[1];
    if (versionMatch) metadata.version = versionMatch[1];
    if (descMatch) metadata.description = descMatch[1];
    if (homepageMatch) metadata.homepage = homepageMatch[1];
    if (repoMatch) metadata.repository = repoMatch[1];
    metadata.keywords = [];
    core.info('✓ Found pyproject.toml');
    return metadata;
  }
  
  // Try Cargo.toml (Rust)
  const cargoPath = path.join(projectPath, 'Cargo.toml');
  if (fs.existsSync(cargoPath)) {
    const toml = fs.readFileSync(cargoPath, 'utf8');
    const nameMatch = toml.match(/name\s*=\s*"([^"]+)"/);
    const versionMatch = toml.match(/version\s*=\s*"([^"]+)"/);
    const descMatch = toml.match(/description\s*=\s*"([^"]+)"/);
    const homepageMatch = toml.match(/homepage\s*=\s*"([^"]+)"/);
    const repoMatch = toml.match(/repository\s*=\s*"([^"]+)"/);
    const keywordsMatch = toml.match(/keywords\s*=\s*\[(.*?)\]/s);
    
    if (nameMatch) metadata.name = nameMatch[1];
    if (versionMatch) metadata.version = versionMatch[1];
    if (descMatch) metadata.description = descMatch[1];
    if (homepageMatch) metadata.homepage = homepageMatch[1];
    if (repoMatch) metadata.repository = repoMatch[1];
    if (keywordsMatch) {
      metadata.keywords = keywordsMatch[1]
        .split(',')
        .map(k => k.trim().replace(/"/g, ''))
        .filter(k => k);
    } else {
      metadata.keywords = [];
    }
    core.info('✓ Found Cargo.toml');
    return metadata;
  }
  
  throw new Error('No package metadata found (package.json, pyproject.toml, or Cargo.toml)');
}

/**
 * Make HTTPS request helper
 */
function httpsRequest(url, options, data = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };
    
    const req = https.request(reqOptions, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve({ statusCode: res.statusCode, body: JSON.parse(body) });
          } catch (e) {
            resolve({ statusCode: res.statusCode, body });
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${body}`));
        }
      });
    });
    
    req.on('error', reject);
    
    if (data) {
      req.write(typeof data === 'string' ? data : JSON.stringify(data));
    }
    
    req.end();
  });
}

/**
 * Check if listing exists
 */
async function findExistingListing(apiKey, name) {
  try {
    const response = await httpsRequest(
      `${MARKETPLACE_API}/listings?name=${encodeURIComponent(name)}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    if (response.body && response.body.data && response.body.data.length > 0) {
      return response.body.data[0].id;
    }
  } catch (error) {
    core.debug(`No existing listing found: ${error.message}`);
  }
  
  return null;
}

/**
 * Submit to NEAR Marketplace
 */
async function submitToMarketplace(apiKey, payload, listingId = null) {
  const method = listingId ? 'PUT' : 'POST';
  const url = listingId 
    ? `${MARKETPLACE_API}/listings/${listingId}`
    : `${MARKETPLACE_API}/listings`;
  
  core.info(`${method} ${url}`);
  core.debug(`Payload: ${JSON.stringify(payload, null, 2)}`);
  
  const response = await httpsRequest(url, {
    method,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': 'github-action-near-marketplace/1.0'
    }
  }, payload);
  
  return response.body;
}

/**
 * Main action logic
 */
async function run() {
  try {
    // Get inputs
    const apiKey = core.getInput('api-key', { required: true });
    const projectPath = core.getInput('project-path') || '.';
    const dryRun = core.getInput('dry-run') === 'true';
    const updateExisting = core.getInput('update-existing') === 'true';
    
    // Read project metadata
    core.info('📦 Reading project metadata...');
    const metadata = readProjectMetadata(projectPath);
    core.info(`   Name: ${metadata.name}`);
    core.info(`   Version: ${metadata.version}`);
    
    // Build submission payload
    const payload = {
      name: core.getInput('name') || metadata.name,
      version: core.getInput('version') || metadata.version || github.context.ref.replace('refs/tags/', ''),
      description: core.getInput('description') || metadata.description || 'No description provided',
      category: core.getInput('category') || 'development',
      homepage: core.getInput('homepage') || metadata.homepage || '',
      repository: core.getInput('repository') || metadata.repository || `https://github.com/${github.context.repo.owner}/${github.context.repo.repo}`,
      tags: [],
      metadata: {
        author: metadata.author || github.context.actor,
        license: metadata.license || 'Unknown',
        release_tag: github.context.ref,
        submitted_at: new Date().toISOString(),
        github_action: true
      }
    };
    
    // Handle tags
    const customTags = core.getInput('tags');
    if (customTags) {
      payload.tags = customTags.split(',').map(t => t.trim()).filter(t => t);
    } else if (metadata.keywords) {
      payload.tags = metadata.keywords;
    }
    
    core.info('');
    core.info('📋 Submission payload:');
    core.info(`   Name: ${payload.name}`);
    core.info(`   Version: ${payload.version}`);
    core.info(`   Category: ${payload.category}`);
    core.info(`   Tags: ${payload.tags.join(', ') || 'none'}`);
    core.info(`   Repository: ${payload.repository}`);
    
    if (dryRun) {
      core.warning('🧪 DRY RUN MODE - Not submitting to marketplace');
      core.setOutput('status', 'dry-run');
      core.setOutput('listing-id', 'dry-run');
      return;
    }
    
    // Check for existing listing
    let listingId = null;
    if (updateExisting) {
      core.info('');
      core.info('🔍 Checking for existing listing...');
      listingId = await findExistingListing(apiKey, payload.name);
      if (listingId) {
        core.info(`   Found existing listing: ${listingId}`);
      } else {
        core.info('   No existing listing found');
      }
    }
    
    // Submit to marketplace
    core.info('');
    core.info(`🚀 ${listingId ? 'Updating' : 'Creating'} marketplace listing...`);
    const result = await submitToMarketplace(apiKey, payload, listingId);
    
    const finalListingId = result.id || result.data?.id || listingId || 'unknown';
    const listingUrl = `${MARKETPLACE_API.replace('/v1', '')}/listing/${finalListingId}`;
    const status = listingId ? 'updated' : 'created';
    
    core.info('');
    core.info('✅ Success!');
    core.info(`   Status: ${status}`);
    core.info(`   Listing ID: ${finalListingId}`);
    core.info(`   URL: ${listingUrl}`);
    
    // Set outputs
    core.setOutput('listing-id', finalListingId);
    core.setOutput('listing-url', listingUrl);
    core.setOutput('status', status);
    
  } catch (error) {
    core.setFailed(`❌ Action failed: ${error.message}`);
    core.setOutput('status', 'error');
  }
}

run();
