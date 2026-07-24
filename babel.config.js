module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // TEM que ser o ÚLTIMO plugin da lista — exigência do próprio
      // react-native-worklets-core (usado pelo frame processor de OCR do
      // Modo Inteligente "tempo real").
      ['react-native-worklets-core/plugin'],
    ],
  };
};
