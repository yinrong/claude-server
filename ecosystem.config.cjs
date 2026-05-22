module.exports = {
  apps: [{
    name: 'claude-server',
    script: 'server/index.js',
    env: {
      PORT: 4280,
      FILES_DIR: '/tmp/claude-hub-files',
      NODE_ENV: 'production',
    },
    restart_delay: 2000,
    max_restarts: 20,
    watch: false,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }],
};
