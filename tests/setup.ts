// Test setup: runs before any test file via bunfig.toml preload.
// Isolates test database and port from the running dev server.
process.env.DB_PATH = "./data/test.db";
process.env.PORT = process.env.PORT || "3099";
process.env.NODE_ENV = "test";
