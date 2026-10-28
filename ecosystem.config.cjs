module.exports = {
  apps: [
    {
      name: 'maxwell-bot',
      cwd: './apps/bot',
      script: 'dist/main.js',
      node_args: '--env-file=../../.env --enable-source-maps',
      exec_mode: 'fork',
      instances: 1,
      kill_timeout: 15_000,
      max_memory_restart: '1G',
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'maxwell-dashboard',
      cwd: './apps/dashboard',
      script: 'node_modules/next/dist/bin/next',
      args: 'start',
      node_args: '--env-file=../../.env',
      exec_mode: 'fork',
      instances: 1,
      env: { NODE_ENV: 'production', PORT: '3000' },
    },
  ],
};
