'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// Mock @actions/core before requiring the module under test
jest.mock('@actions/core', () => ({
  getInput: jest.fn(),
  info: jest.fn(),
  warning: jest.fn(),
  debug: jest.fn(),
  setOutput: jest.fn(),
  setFailed: jest.fn(),
}));

jest.mock('@actions/github', () => ({
  context: {
    repo: { owner: 'testowner', repo: 'testrepo' },
    ref: 'refs/tags/v1.2.3',
    actor: 'testactor',
    runId: 42,
    sha: 'abc123',
  },
}));

const {
  readProjectMetadata,
  readFromPackageJson,
  readFromPyproject,
  readFromCargo,
  validatePayload,
} = require('../src/index');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'near-action-test-'));
}

// ---------------------------------------------------------------------------
// readFromPackageJson
// ---------------------------------------------------------------------------

describe('readFromPackageJson', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  test('returns null when package.json absent', () => {
    expect(readFromPackageJson(tmpDir)).toBeNull();
  });

  test('parses valid package.json', () => {
    const pkg = {
      name: 'my-tool',
      version: '1.2.3',
      description: 'A test tool',
      homepage: 'https://example.com',
      keywords: ['near', 'tool'],
      license: 'MIT',
      repository: { type: 'git', url: 'https://github.com/a/b.git' },
      author: { name: 'Alice' },
    };
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(pkg));
    const meta = readFromPackageJson(tmpDir);
    expect(meta.name).toBe('my-tool');
    expect(meta.version).toBe('1.2.3');
    expect(meta.keywords).toEqual(['near', 'tool']);
    expect(meta.repository).toBe('https://github.com/a/b.git');
    expect(meta.author).toBe('Alice');
  });

  test('throws on invalid JSON', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{ bad json }');
    expect(() => readFromPackageJson(tmpDir)).toThrow(/Failed to parse package.json/);
  });
});

// ---------------------------------------------------------------------------
// readFromPyproject
// ---------------------------------------------------------------------------

describe('readFromPyproject', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  test('returns null when pyproject.toml absent', () => {
    expect(readFromPyproject(tmpDir)).toBeNull();
  });

  test('parses name, version, description', () => {
    const toml = `
[project]
name = "my-python-tool"
version = "0.3.1"
description = "Does things"
keywords = ["near", "python"]
`;
    fs.writeFileSync(path.join(tmpDir, 'pyproject.toml'), toml);
    const meta = readFromPyproject(tmpDir);
    expect(meta.name).toBe('my-python-tool');
    expect(meta.version).toBe('0.3.1');
    expect(meta.description).toBe('Does things');
    expect(meta.keywords).toContain('near');
  });
});

// ---------------------------------------------------------------------------
// readFromCargo
// ---------------------------------------------------------------------------

describe('readFromCargo', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  test('returns null when Cargo.toml absent', () => {
    expect(readFromCargo(tmpDir)).toBeNull();
  });

  test('parses name, version, description', () => {
    const toml = `
[package]
name = "my-rust-tool"
version = "2.0.0"
description = "Fast Rust thing"
license = "Apache-2.0"
keywords = ["near", "rust", "wasm"]
`;
    fs.writeFileSync(path.join(tmpDir, 'Cargo.toml'), toml);
    const meta = readFromCargo(tmpDir);
    expect(meta.name).toBe('my-rust-tool');
    expect(meta.version).toBe('2.0.0');
    expect(meta.license).toBe('Apache-2.0');
    expect(meta.keywords).toContain('rust');
  });
});

// ---------------------------------------------------------------------------
// readProjectMetadata (priority)
// ---------------------------------------------------------------------------

describe('readProjectMetadata', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  test('prefers package.json over pyproject.toml', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'js-pkg', version: '1.0.0' }));
    fs.writeFileSync(path.join(tmpDir, 'pyproject.toml'), '[project]\nname = "py-pkg"\n');
    const meta = readProjectMetadata(tmpDir);
    expect(meta.name).toBe('js-pkg');
  });

  test('throws when no manifest found', () => {
    expect(() => readProjectMetadata(tmpDir)).toThrow(/No supported manifest found/);
  });

  test('throws when project path does not exist', () => {
    // readProjectMetadata itself doesn't check path existence — the caller does
    // But it throws "No supported manifest" for a fresh empty dir
    const fakePath = path.join(tmpDir, 'nonexistent');
    // The dir doesn't exist, so readFromPackageJson etc. return null
    expect(() => readProjectMetadata(fakePath)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// validatePayload
// ---------------------------------------------------------------------------

describe('validatePayload', () => {
  const validPayload = {
    name: 'test-tool',
    version: '1.0.0',
    description: 'A test tool',
    category: 'development',
    repository: 'https://github.com/a/b',
    homepage: 'https://example.com',
    long_description: 'Long description here',
    changelog: 'Fixed bugs',
    license: 'MIT',
  };

  test('no errors or warnings for a complete payload', () => {
    const { errors, warnings } = validatePayload(validPayload);
    expect(errors).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  test('errors on missing required field', () => {
    const { name, ...noName } = validPayload;
    const { errors } = validatePayload(noName);
    expect(errors.some(e => e.includes('"name"'))).toBe(true);
  });

  test('errors on empty required field', () => {
    const { errors } = validatePayload({ ...validPayload, description: '' });
    expect(errors.some(e => e.includes('"description"'))).toBe(true);
  });

  test('warning for missing optional field (homepage)', () => {
    const { homepage, ...noHomepage } = validPayload;
    const { errors, warnings } = validatePayload(noHomepage);
    expect(errors).toHaveLength(0);
    expect(warnings.some(w => w.includes('"homepage"'))).toBe(true);
  });

  test('warning for non-semver version', () => {
    const { warnings } = validatePayload({ ...validPayload, version: 'latest' });
    expect(warnings.some(w => w.includes('semver'))).toBe(true);
  });

  test('no version warning for proper semver', () => {
    const { warnings } = validatePayload({ ...validPayload, version: '2.1.0-beta.1' });
    // semver warning should not appear
    expect(warnings.some(w => w.includes('semver'))).toBe(false);
  });

  test('multiple missing required fields → multiple errors', () => {
    const { errors } = validatePayload({ name: 'x' });
    expect(errors.length).toBeGreaterThan(1);
  });
});
