// Environment of the server under test (e2e/server.sh). `seed user` shares the
// cookie keys to mint session cookies; GOOGLE_ADMIN_ID makes that user an admin.
export const PORT = 8765;
const DB = 'e2e/.tmp/db/e2e.db';

export const env = {
    PORT: String(PORT),
    SQLITE_PATH: DB,
    E2E_DB: DB,
    COOKIE_HASH_KEY: 'e2e-hash-key-0123456789abcdef0123456789abcdef',
    COOKIE_BLOCK_KEY: 'e2e-block-key-0123456789abcdefgh',
    GOOGLE_ADMIN_ID: 'e2e-admin',
    PUBLIC_BASE_URL: `http://localhost:${PORT}`, // podcast RSS feed
};
