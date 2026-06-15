const CLAUDE_ENV = {
  ANTHROPIC_BASE_URL: 'http://127.0.0.1:4290/anthropic',
  ANTHROPIC_AUTH_TOKEN: 'sk-UFop8bGkZVJZUz1FVS9E5w20r1591Kj1d8i6i6AlI7VXkeic',
  ANTHROPIC_DEFAULT_OPUS_MODEL: 'ppio/pa/claude-opus-4-6',
  ANTHROPIC_DEFAULT_SONNET_MODEL: 'ppio/pa/claude-opus-4-6',
  ANTHROPIC_DEFAULT_HAIKU_MODEL: 'ppio/pa/claude-opus-4-6',
};

module.exports = {
  apps: [
    {
      name: 'model-fix-proxy',
      script: 'model-proxy.js',
      env: {
        UPSTREAM_URL: 'http://model.mify.ai.srv',
        PROXY_PORT: 4290,
      },
      restart_delay: 1000,
      max_restarts: 50,
      watch: false,
    },
    {
      // ai-hub-router: Python aiohttp — central coordinator (router/server.py)
      // Starts after model-fix-proxy, before server processes
      name: 'ai-hub-router',
      script: 'router/server.py',
      interpreter: process.env.ROUTER_PYTHON || 'python3',
      interpreter_args: '-m x',
      cwd: __dirname,
      env: {
        X_PORT: '4291',
        X_HOST: '0.0.0.0',
        X_DB_PATH: 'data/router.db',
        X_RELEASES_DIR: 'data/releases',
        X_BASE_URL: 'https://yinaisvr.duckdns.org',
        INTERNAL_LLM_BASE: 'http://model.mify.ai.srv',
        RELAY_ADDR: 'yinaisvr.duckdns.org',
        RELAY_PORT: '8443',
        TUNNEL_SECRET: 'tun-B0preuZ7Bq0lbV9Kh_7VYyeZP8VLsBVGAqpi4sEomAM',
        RELAY_TLS: 'true',
        LLMROUTER_HOME: 'data/llmrouter',
      },
      restart_delay: 2000,
      max_restarts: 20,
      watch: false,
    },
    {
      name: 'ai-hub-server-prod',
      script: 'server/index.js',
      env: {
        PORT: 4280,
        DB_PATH: 'data/prod.db',
        FILES_DIR: 'data/prod-files',
        NODE_ENV: 'production',
        ...CLAUDE_ENV,
      },
      restart_delay: 2000,
      max_restarts: 20,
      watch: false,
    },
    {
      name: 'ai-hub-server-prev',
      script: 'server/index.js',
      env: {
        PORT: 4281,
        DB_PATH: 'data/prev.db',
        FILES_DIR: 'data/prev-files',
        NODE_ENV: 'production',
        ...CLAUDE_ENV,
      },
      restart_delay: 2000,
      max_restarts: 20,
      watch: false,
    },
    {
      name: 'ai-hub-server-dev',
      script: 'server/index.js',
      env: {
        PORT: 4282,
        DB_PATH: 'data/dev-next.db',
        FILES_DIR: 'data/dev-next-files',
        NODE_ENV: 'development',
        ...CLAUDE_ENV,
      },
      restart_delay: 1000,
      max_restarts: 10,
      watch: false,
    },
  ],
};
