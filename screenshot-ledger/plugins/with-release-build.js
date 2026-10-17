const { withAppBuildGradle, withGradleProperties } = require('@expo/config-plugins');

const KEYSTORE_DEFS = `def hasReleaseKeystore = rootProject.file("../keystore.properties").exists()
def releaseKeystoreProperties = new Properties()
if (hasReleaseKeystore) {
    rootProject.file("../keystore.properties").withInputStream { releaseKeystoreProperties.load(it) }
}
`;

const SIGNING_CONFIGS_ORIGINAL = `    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
`;

const SIGNING_CONFIGS_PATCHED = `    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        release {
            if (hasReleaseKeystore) {
                storeFile rootProject.file(releaseKeystoreProperties['storeFile'])
                storePassword releaseKeystoreProperties['storePassword']
                keyAlias releaseKeystoreProperties['keyAlias']
                keyPassword releaseKeystoreProperties['keyPassword']
            }
        }
    }
    splits {
        abi {
            enable true
            reset()
            include 'arm64-v8a', 'armeabi-v7a'
            universalApk false
        }
    }
`;

const RELEASE_SIGNING_ORIGINAL = `            signingConfig signingConfigs.debug
            def enableShrinkResources`;

const ENV_INPUT_BLOCK = `// EXPO_PUBLIC_* 在 JS 打包期内联进 bundle：让 .env 变化自动触发重新打包
def envFile = rootProject.file("../.env")
if (envFile.exists()) {
    tasks.matching { it.name.startsWith('createBundle') }.configureEach {
        inputs.file(envFile)
    }
}
`;

const RELEASE_SIGNING_PATCHED = `            signingConfig hasReleaseKeystore ? signingConfigs.release : signingConfigs.debug
            def enableShrinkResources`;

module.exports = function withReleaseBuild(config) {
  config = withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') return cfg;
    let contents = cfg.modResults.contents;

    if (!contents.includes('hasReleaseKeystore')) {
      contents = contents.replace('\nandroid {', `\n${KEYSTORE_DEFS}android {`);
    }
    if (contents.includes(SIGNING_CONFIGS_ORIGINAL)) {
      contents = contents.replace(SIGNING_CONFIGS_ORIGINAL, SIGNING_CONFIGS_PATCHED);
    }
    if (contents.includes(RELEASE_SIGNING_ORIGINAL)) {
      contents = contents.replace(RELEASE_SIGNING_ORIGINAL, RELEASE_SIGNING_PATCHED);
    }
    if (!contents.includes('inputs.file(envFile)')) {
      contents += `\n${ENV_INPUT_BLOCK}`;
    }

    cfg.modResults.contents = contents;
    return cfg;
  });

  config = withGradleProperties(config, (cfg) => {
    function setProperty(key, value) {
      const existing = cfg.modResults.find(
        (item) => item.type === 'property' && item.key === key,
      );
      if (existing) existing.value = value;
      else cfg.modResults.push({ type: 'property', key, value });
    }
    setProperty('reactNativeArchitectures', 'arm64-v8a,armeabi-v7a');
    setProperty('expo.useLegacyPackaging', 'true');
    return cfg;
  });

  return config;
};
