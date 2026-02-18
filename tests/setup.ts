// Test setup: runs before any test file via bunfig.toml preload.
// Isolates test database from the app database.
process.env.DB_PATH = "./data/test.db";
