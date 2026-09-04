'use strict';

const { AsyncLocalStorage } = require('async_hooks');

const runtimeStorage = new AsyncLocalStorage();

function runWithRuntime(runtime, fn) {
  return runtimeStorage.run(runtime, fn);
}

function currentRuntime() {
  return runtimeStorage.getStore() || null;
}

function getEnv(name, fallback = '') {
  const runtime = currentRuntime();
  if (runtime?.env && runtime.env[name] !== undefined) return runtime.env[name];
  return typeof process !== 'undefined' && process.env && process.env[name] !== undefined ? process.env[name] : fallback;
}

function getDbExecutor() {
  return currentRuntime()?.dbClient || null;
}

module.exports = { runWithRuntime, currentRuntime, getEnv, getDbExecutor };
