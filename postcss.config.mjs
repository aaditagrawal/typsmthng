import { stylexOptions } from './stylex.config.mjs';
export default {
  plugins: {
    '@stylexjs/postcss-plugin': {
      include: ['src/**/*.tsx'],
      babelConfig: {
        babelrc: false,
        configFile: false,
        parserOpts: { plugins: ['typescript', 'jsx'] },
        plugins: [['@stylexjs/babel-plugin', stylexOptions]],
      },
      useCSSLayers: true,
    },
  },
};
