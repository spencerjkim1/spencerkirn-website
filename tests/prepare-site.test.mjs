import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildSite } from '../scripts/prepare-site.mjs';

async function fixture(t) {
    const root = await mkdtemp(join(process.env.OPENCODE_TEST_TMPDIR ?? tmpdir(), 'website-build-test-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    for (const path of ['index.html', 'demo.html', '_redirects', '_routes.json']) await writeFile(join(root, path), path);
    for (const path of ['assets', 'demo']) await mkdir(join(root, path));
    return root;
}

test('public build excludes credentials, repository internals, and server code', async (t) => {
    const root = await fixture(t);
    await writeFile(join(root, '.dev.vars'), 'FAKE_SECRET=do-not-publish');
    await mkdir(join(root, 'functions'));
    await writeFile(join(root, 'functions', 'private.js'), 'server-only');
    await writeFile(join(root, 'assets', '.env'), 'FAKE_SECRET=do-not-publish');
    await writeFile(join(root, 'assets', 'site.css'), 'body{}');
    const output = await buildSite(root);
    assert.equal(await readFile(join(output, 'assets', 'site.css'), 'utf8'), 'body{}');
    for (const path of ['.dev.vars', 'functions', 'assets/.env', 'package.json']) await assert.rejects(access(join(output, path)));
    assert.match(await readFile(join(output, '404.html'), 'utf8'), /NOT FOUND/);
    assert.equal(await readFile(join(output, 'demos.html'), 'utf8'), await readFile(join(output, 'demo.html'), 'utf8'));
});

test('rebuilds remove stale generated files without touching source credentials', async (t) => {
    const root = await fixture(t);
    const output = await buildSite(root);
    await writeFile(join(output, 'stale.txt'), 'old generated content');
    await writeFile(join(root, '.dev.vars'), 'FAKE_SECRET=keep-this');
    await buildSite(root);
    await assert.rejects(access(join(output, 'stale.txt')));
    assert.equal(await readFile(join(root, '.dev.vars'), 'utf8'), 'FAKE_SECRET=keep-this');
});

test('does not overwrite an existing unmarked output directory', async (t) => {
    const root = await fixture(t);
    await mkdir(join(root, '.site'));
    await writeFile(join(root, '.site', 'user-work.txt'), 'keep');
    await assert.rejects(buildSite(root), /unrecognized/);
    assert.equal(await readFile(join(root, '.site', 'user-work.txt'), 'utf8'), 'keep');
});

test('symbolic links cannot pull credentials into public assets', async (t) => {
    const root = await fixture(t);
    await writeFile(join(root, '.dev.vars'), 'FAKE_SECRET=do-not-publish');
    await symlink(join(root, '.dev.vars'), join(root, 'assets', 'leak.txt'));
    await assert.rejects(buildSite(root), /symbolic links/);
});
