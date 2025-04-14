module.exports = {
  presets: [
    ['@babel/preset-env', {
      targets: {node: 'current'},
      modules: 'commonjs'  // Force babel to transform ESM to CommonJS for Jest
    }],
    '@babel/preset-typescript',
  ],
}; 