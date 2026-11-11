import { cp, lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const publicPaths = ['index.html', 'demo.html', 'assets', 'demo', '_redirects'];
const markerName = '.generated-site';
const markerValue = 'Generated public files for spencerkirn-website.\n';

export async function buildSite(root = projectRoot) {
    const output = join(root, '.site');
    try {
        const info = await lstat(output);
        if (!info.isDirectory() || info.isSymbolicLink() || await readFile(join(output, markerName), 'utf8') !== markerValue) {
            throw new Error('Refusing to replace an unrecognized .site directory.');
        }
        // Only replace our explicitly marked, generated output—not source files.
        await rm(output, { recursive: true });
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        // If .site exists but its marker is missing, it may be user work.
        try {
            await lstat(output);
            throw new Error('Refusing to replace an unrecognized .site directory.');
        } catch (check) { if (check.code !== 'ENOENT') throw check; }
    }
    await mkdir(output);
    await writeFile(join(output, markerName), markerValue);
    await writeFile(join(output, '.assetsignore'), `${markerName}\n`);
    for (const path of publicPaths) {
        await cp(join(root, path), join(output, path), {
            recursive: true,
            filter: async (source) => {
                if (basename(source).startsWith('.') || basename(source) === 'node_modules') return false;
                if ((await lstat(source)).isSymbolicLink()) throw new Error('Public assets must not contain symbolic links.');
                return true;
            },
        });
    }
    await writeFile(join(output, '404.html'), '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Not found — Spencer Kim</title><body style="font-family:Helvetica,Arial,sans-serif;padding:60px"><h1>NOT FOUND</h1><a href="/">Back to Spencer Kim →</a></body></html>\n');
    // Both hub URLs share one source, without a rewrite triggering HTML canonicalization.
    await cp(join(output, 'demo.html'), join(output, 'demos.html'));
    return output;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    buildSite().then(() => console.log('Prepared public files in .site (credentials and server code excluded).')).catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
