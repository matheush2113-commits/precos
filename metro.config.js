const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Suporte para arquivos .cjs (se necessário)
config.resolver.assetExts.push('cjs');

module.exports = config;
