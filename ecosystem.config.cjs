module.exports = {
  apps: [
    {
      name: 'claude-server-prod',
      script: 'server/index.js',
      env: {
        PORT: 4280,
        DB_PATH: 'data/prod.db',
        FILES_DIR: 'data/prod-files',
        NODE_ENV: 'production',
      },
      restart_delay: 2000,
      max_restarts: 20,
      watch: false,
    },
    {
      name: 'claude-server-prev',
      script: 'server/index.js',
      env: {
        PORT: 4281,
        DB_PATH: 'data/dev.db',
        FILES_DIR: 'data/dev-files',
        NODE_ENV: 'production',
      },
      restart_delay: 2000,
      max_restarts: 20,
      watch: false,
    },
    {
      name: 'claude-server-dev',
      script: 'server/index.js',
      env: {
        PORT: 4283,
        DB_PATH: 'data/dev-next.db',
        FILES_DIR: 'data/dev-next-files',
        NODE_ENV: 'development',
      },
      restart_delay: 1000,
      max_restarts: 10,
      watch: false,
    },
  ],
};
