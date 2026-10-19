import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// sw.js precaches the app shell for offline use. A module or stylesheet missing
// from SHELL_ASSETS works online but breaks the app offline, so keep the list
// in sync with what is on disk and what index.html loads.

const root = resolve(import.meta.dirname, '../..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

const sw = read('sw.js');
const shellAssets = [...sw.match(/const SHELL_ASSETS = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)]
    .map((m) => m[1])
    .filter((a) => a.startsWith('/'));

const listDir = (dir, ext) => readdirSync(resolve(root, dir))
    .filter((f) => f.endsWith(ext))
    .map((f) => `/${dir}/${f}`);

describe('service worker shell cache', () => {
    it('precaches every JS module and stylesheet', () => {
        const onDisk = [...listDir('js', '.js'), ...listDir('css', '.css'), '/style.css'];
        expect(onDisk.filter((f) => !shellAssets.includes(f))).toEqual([]);
    });

    it('precaches every local asset index.html loads', () => {
        const html = read('index.html');
        const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)]
            .map((m) => m[1])
            .filter((u) => !/^(https?:|#|mailto:)/.test(u) && /\.(js|css|svg|json)(\?|$)/.test(u))
            .map((u) => '/' + u.replace(/^\//, '').replace(/\?.*$/, ''));
        expect([...new Set(refs)].filter((u) => !shellAssets.includes(u))).toEqual([]);
    });

    it('lists only files that exist', () => {
        const missing = shellAssets.filter((a) => a !== '/' && !existsSync(resolve(root, a.slice(1))));
        expect(missing).toEqual([]);
    });
});
