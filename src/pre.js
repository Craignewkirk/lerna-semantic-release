var async = require('async');
var cwd = require('process').cwd;
var fs = require('fs');
var path = require('path');
var npmconf = require('npmconf');
var rc = require('rc');
var shell = require('shelljs');

var srPre = require('semantic-release/dist/pre');
var srNormalize = require('semantic-release/dist/lib/plugins').normalize;
var srRegistry = require('semantic-release/dist/lib/get-registry');

var makeTag = require('./utils/make-tag');
var concurrentGit = require('./utils/concurrent-git');

function getPkgLocation () {
  return path.join(cwd(), 'package.json')
}

function getPkg () {
  return JSON.parse(fs.readFileSync(getPkgLocation()))
}

function getNpmConfig (done) {
  npmconf.load({}, done);
}

function makeSrConfig (npmConfig, done) {
  var pkg = getPkg();

  var defaults = {
    options: {
      branch: 'master'
    }
  };

  var srConfig = Object.assign({}, defaults, {
    env: process.env,
    plugins: {
      "analyzeCommits": require('./plugins/analyzer.js'),
      "getLastRelease": require('./plugins/last-release.js'),
      "verifyRelease": srNormalize({}, "semantic-release/dist/lib/plugin-noop")
    },
    npm: {
      auth: {
        token: process.env.NPM_TOKEN
      },
      loglevel: npmConfig.get('loglevel'),
      registry: srRegistry(pkg, npmConfig),
      tag: (pkg.publishConfig || {}).tag || npmConfig.get('tag') || 'latest'
    },
    pkg: pkg

  });

  done(null, srConfig);
}

function pre (srConfig, done) {
  srPre(srConfig, function (err, nextRelease) {
    done(null, nextRelease);
  });
}

function tag (nextRelease, done) {
  if (!nextRelease) {
    done(null);
    return;
  }

  var tag = makeTag(getPkg().name, nextRelease.version);

  console.log('Creating tag', tag);

  function nextAsyncShell (asyncDoneCallback) {
    return function (code, stdout, stderr) {
      console.log('return code: ', code);
      console.log('stdout: ', stdout.toString());
      console.log('stderr: ', stderr.toString());

      asyncDoneCallback(code === 0 ? null : code);
    }
  }

  async.series([
    function (done) {
      shell.exec('npm version ' + nextRelease.type + ' --git-tag-version false', nextAsyncShell(done))
    },
    function (done) {
      concurrentGit('commit -anm\'chore: (' + tag + '): releasing component\' --allow-empty', nextAsyncShell(done))
    },
    function (done) {
      concurrentGit('tag ' + tag, nextAsyncShell(done))
    }
  ], done);
}

module.exports = function () {
  async.waterfall([
    getNpmConfig,
    makeSrConfig,
    pre,
    tag
  ]);
};
