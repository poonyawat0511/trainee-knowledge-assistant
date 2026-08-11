const { defineConfig } = require('vitest/config')
const path = require('path')

module.exports = defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/modules/**/application/**', 'src/shared/**'],
      exclude: ['**/*.sql'],
    },
  },
})
